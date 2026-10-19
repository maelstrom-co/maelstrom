import { type BrowserVad, createBrowserVad } from './browser-vad.js';
import type { ResolvedBrowserVadConfig } from './browser-vad-config.js';

/** Local speaker gating only; provider turn detection and cancellation remain unchanged. */
export interface PlaybackBargeIn {
  /** Settles when detection is ready, unavailable, or retired. Never rejects. */
  readonly ready: Promise<void>;
  /** Attaches received audio, never microphone/publication tracks. Repeated calls admit newly received tracks. */
  attach(stream: MediaStream): void;
  /** Fences callbacks, restores prior track values, and releases only local detection resources. */
  destroy(): void;
}

/** Configuration for an optional, connection-owned local playback gate. */
export interface PlaybackBargeInOptions {
  /** Already-owned microphone capture; this helper neither acquires nor stops it. */
  readonly microphone: MediaStream;
  /** Validated browser detector settings; transport pre-roll is unused. */
  readonly config: Extract<ResolvedBrowserVadConfig, { enabled: true }>;
  /** Reports fallback to provider-only interruption, without media or exception payloads. */
  readonly onUnavailable: () => void;
}

const QUIET_MS = 200;
const SAMPLE_MS = 20;
const QUIET_RMS = 0.005;

/**
 * Mutes received tracks on local speech onset, including tracks attached later.
 * Speech end alone cannot expose old output: recovery requires 200ms of observed
 * remote quiet after speech ends. A VAD misfire restores immediately. A private
 * enabled clone measures incoming audio while the playback track is disabled;
 * no probe audio reaches the destination. This is not provider cancellation.
 * Continuous old output stays muted, and a new reply without a quiet gap can be
 * clipped. Initialization or monitoring failure restores provider-only behavior.
 */
export function createPlaybackBargeIn(
  options: PlaybackBargeInOptions,
): PlaybackBargeIn {
  let retired = false;
  let speaking = false;
  let gated = false;
  let previouslyGated = false;
  let quietSince: number | undefined;
  let lastSample: number | undefined;
  let vad: BrowserVad | undefined;
  let context: AudioContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const tracks = new Map<
    MediaStreamTrack,
    {
      enabled?: boolean;
      probe: MediaStreamTrack;
      source: MediaStreamAudioSourceNode;
      analyser: AnalyserNode;
      samples: Float32Array<ArrayBuffer>;
    }
  >();
  let settle!: () => void;
  const ready = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const startup = setTimeout(() => unavailable(), 5000);

  function restore(): void {
    gated = false;
    quietSince = undefined;
    for (const [track, state] of tracks) {
      if (state.enabled !== undefined) {
        track.enabled = state.enabled;
        state.enabled = undefined;
      }
    }
  }

  function destroy(): void {
    if (retired) return;
    retired = true;
    clearTimeout(startup);
    clearInterval(timer);
    restore();
    for (const state of tracks.values()) {
      state.source.disconnect();
      state.analyser.disconnect();
      state.probe.stop();
    }
    tracks.clear();
    void vad?.destroy().catch(() => {});
    void context?.close().catch(() => {});
    settle();
  }

  function unavailable(): void {
    if (retired) return;
    destroy();
    options.onUnavailable();
  }

  function sample(): void {
    if (retired || !context) return;
    if (context.state !== 'running') {
      unavailable();
      return;
    }
    const now = context.currentTime * 1000;
    if (lastSample !== undefined && now - lastSample > SAMPLE_MS * 4)
      quietSince = undefined;
    lastSample = now;
    if (!gated || speaking) {
      quietSince = undefined;
      return;
    }
    let quiet = tracks.size > 0;
    for (const state of tracks.values()) {
      state.analyser.getFloatTimeDomainData(state.samples);
      const rms = Math.sqrt(
        state.samples.reduce((sum, value) => sum + value * value, 0) /
          state.samples.length,
      );
      if (!Number.isFinite(rms) || rms >= QUIET_RMS) quiet = false;
    }
    if (!quiet) quietSince = undefined;
    else {
      quietSince ??= now;
      if (now - quietSince >= QUIET_MS) restore();
    }
  }

  function attach(stream: MediaStream): void {
    if (retired || !context) return;
    try {
      const incoming = stream.getAudioTracks();
      for (const [track, state] of tracks) {
        if (incoming.includes(track)) continue;
        if (state.enabled !== undefined) track.enabled = state.enabled;
        state.source.disconnect();
        state.analyser.disconnect();
        state.probe.stop();
        tracks.delete(track);
      }
      quietSince = undefined;
      for (const track of incoming) {
        if (tracks.has(track)) continue;
        if (options.microphone.getTracks().includes(track))
          throw new Error('Playback must not contain microphone tracks');
        const probe = track.clone();
        let source: MediaStreamAudioSourceNode | undefined;
        let analyser: AnalyserNode | undefined;
        try {
          probe.enabled = true;
          source = context.createMediaStreamSource(new MediaStream([probe]));
          analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
          tracks.set(track, {
            probe,
            source,
            analyser,
            samples: new Float32Array(analyser.fftSize),
            enabled: gated ? track.enabled : undefined,
          });
          if (gated) track.enabled = false;
        } catch (error) {
          source?.disconnect();
          analyser?.disconnect();
          probe.stop();
          throw error;
        }
      }
    } catch {
      unavailable();
    }
  }

  void (async () => {
    try {
      context = new AudioContext();
      await context.resume();
      if (retired) return;
      if (context.state !== 'running')
        throw new Error('Audio monitoring unavailable');
      const created = await createBrowserVad({
        stream: options.microphone,
        config: options.config,
        startTurn: async () => {
          if (retired) return;
          speaking = true;
          previouslyGated = gated;
          quietSince = undefined;
          if (gated) return;
          gated = true;
          for (const [track, state] of tracks) {
            state.enabled = track.enabled;
            track.enabled = false;
          }
        },
        endTurn: async () => {
          if (retired) return;
          speaking = false;
          quietSince = undefined;
        },
        cancelTurn: async () => {
          if (retired) return;
          speaking = false;
          quietSince = undefined;
          if (!previouslyGated) restore();
        },
        onFailure: async () => unavailable(),
      });
      if (retired) {
        await created.destroy();
        return;
      }
      vad = created;
      timer = setInterval(() => {
        try {
          sample();
        } catch {
          unavailable();
        }
      }, SAMPLE_MS);
      clearTimeout(startup);
      settle();
    } catch {
      unavailable();
    }
  })();

  return { ready, attach, destroy };
}
