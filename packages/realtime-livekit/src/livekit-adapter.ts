import { Logger } from '@maelstrom-co/client';
import type { Unsubscribe } from '@maelstrom-co/client';
import { ToolCallId } from '@maelstrom-co/protocol';
import type {
  AdapterConnectOptions,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
} from '@maelstrom-co/realtime';
import { Room, RoomEvent, Track, setLogLevel } from 'livekit-client';
import type { RemoteTrack, TranscriptionSegment } from 'livekit-client';

import type { LiveKitAdapterOptions } from './livekit-adapter.types.js';
import { SPEAK_TOPIC, TTS_TOPIC, TURN_TOPIC } from './protocol.js';

// Quiet the livekit-client SDK's verbose signal/connection logging (which dumps
// the full connect URL on every join). Warnings and errors still surface.
setLogLevel('warn');

/**
 * A {@link RealtimeProviderAdapter} backed by a LiveKit cascaded STT/TTS
 * pipeline instead of a speech-native realtime model. It joins a LiveKit room,
 * publishes a hold-to-talk mic, and — this is the spike's core idea —
 * **synthesizes an `update_ui` tool call from each final user transcript** so a
 * cascaded pipeline drives the exact same {@link RealtimeSession} machinery
 * (speak-after-render, barge-in, sidechannel events) as the OpenAI realtime
 * adapter, with no LLM in the loop on either side.
 *
 * A companion worker (`@maelstrom-co/realtime-livekit-agent`) owns the actual
 * STT (Deepgram) and TTS (Cartesia); this adapter only relays over the room:
 * transcripts in (`RoomEvent.TranscriptionReceived`), speak text out
 * (`SPEAK_TOPIC`). Tool calls, tool results, and speak-after-render sequencing
 * are all `RealtimeSession`'s concern — the same code path every provider uses.
 *
 * The WebRTC/room plumbing itself is not unit-tested; the transcript →
 * tool-call synthesis, tool-result → speak-topic payload, and state mapping it
 * delegates to are.
 *
 * @example
 * ```ts
 * const adapter = new LiveKitAdapter({
 *   getToken: (roomName) => fetchLiveKitToken(roomName),
 *   roomName: `maelstrom-${sessionId}`,
 * });
 * const session = new RealtimeSession({ adapter, instance, sessionId });
 * await session.connect();
 * // Hold-to-talk, driven from the demo UI holding the concrete instance:
 * await adapter.startTalking();
 * await adapter.stopTalking();
 * ```
 */
export class LiveKitAdapter implements RealtimeProviderAdapter {
  readonly #getToken: LiveKitAdapterOptions['getToken'];
  readonly #roomName: string;
  readonly #logger: Logger;
  readonly #handlers = new Set<(event: RealtimeAdapterEvent) => void>();

  #room: Room | undefined;
  #audioEl: HTMLAudioElement | undefined;
  // Guards the window between connect() being called and `#room` being
  // usable — `getToken()` and `room.connect()` are awaited, so without this a
  // second connect() during that round-trip would open a second room.
  #connecting = false;
  #callSeq = 0;

  constructor(options: LiveKitAdapterOptions) {
    this.#getToken = options.getToken;
    this.#roomName = options.roomName;
    this.#logger = new Logger(options.debug ?? false, 'LiveKitAdapter');
  }

  /**
   * Joins the LiveKit room and wires the transcript/TTS relay.
   *
   * Phase-1 degeneracy: `opts.tools` and `opts.instructions` are intentionally
   * ignored. There is no LLM in the worker to configure — this adapter always
   * synthesizes a single `update_ui` tool call per transcript regardless of
   * the declared tool set. When a worker-side LLM lands, `tools`/`instructions`
   * become its session config (declared tools + system prompt), matching how
   * {@link RealtimeProviderAdapter}'s speech-native implementations consume
   * them today.
   */
  async connect(_opts: AdapterConnectOptions): Promise<void> {
    if (this.#room || this.#connecting) {
      throw new Error('LiveKit adapter is already connected');
    }
    this.#connecting = true;
    this.#emit({ type: 'state', state: 'connecting' });

    const room = new Room();
    this.#room = room;
    this.#wireRoomEvents(room);

    try {
      const { token, url } = await this.#getToken(this.#roomName);
      await room.connect(url, token);
      // Publish the mic track, then mute it via the SAME API used by
      // start/stopTalking. Muting through setMicrophoneEnabled (not a direct
      // track.mute()) keeps the publication's enabled flag in sync, so
      // startTalking's setMicrophoneEnabled(true) is a real false→true toggle
      // that actually unmutes. A direct track.mute() leaves the publication
      // "enabled", making the later enable a silent no-op.
      await room.localParticipant.setMicrophoneEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(false);
    } catch (error) {
      this.#teardown();
      this.#connecting = false;
      this.#emit({ type: 'state', state: 'error' });
      throw error;
    }

    this.#connecting = false;
    this.#emit({ type: 'state', state: 'connected' });
  }

  async disconnect(): Promise<void> {
    await this.#room?.disconnect();
    this.#teardown();
  }

  /**
   * Relays a tool result back to the user as speech: extracts the summary
   * string and sends it over the `speak` text stream, where the worker
   * synthesizes it via Cartesia and plays it into the room. Speak-after-render
   * ordering is not this adapter's concern — {@link RealtimeSession} only
   * calls this once the render has settled.
   */
  async sendToolResult(callId: ToolCallId, output: unknown): Promise<void> {
    const summary = extractSummary(output);
    this.#logger.debug('→ speak', { callId, summary });
    const room = this.#room;
    if (!room) {
      this.#emit({
        type: 'error',
        error: new Error(`sendToolResult: no room (callId=${callId})`),
      });
      return;
    }
    this.#emit({ type: 'state', state: 'speaking' });
    try {
      await room.localParticipant.sendText(summary, { topic: SPEAK_TOPIC });
    } catch (error) {
      this.#emit({ type: 'error', error });
    } finally {
      // The worker owns the actual TTS playback and gives no completion
      // signal, so "speaking" collapses back to "connected" when the text is
      // handed off, not when audio finishes — see the ergonomics note.
      this.#emit({ type: 'state', state: 'connected' });
    }
  }

  /**
   * No-op in phase 1: grounding is ambient context injected into a model's
   * session, and there is no model in this cascaded pipeline to inject into.
   * It lands here (rather than being dropped by the session) only once a
   * worker-side LLM exists to receive it.
   */
  injectGrounding(_text: string): void {
    // Intentionally empty — see JSDoc.
  }

  on(handler: (event: RealtimeAdapterEvent) => void): Unsubscribe {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  /**
   * Concrete-only (not on {@link RealtimeProviderAdapter}): unmutes the mic for
   * a hold-to-talk press. The demo holds this instance directly, so this extra
   * surface never leaks through the provider seam.
   */
  async startTalking(): Promise<void> {
    const room = this.#room;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(true);
    this.#emit({ type: 'speech_started' });
    this.#emit({ type: 'state', state: 'listening' });
  }

  /**
   * Concrete-only: ends a hold-to-talk press. Signals the worker to flush its
   * STT buffer (one combined transcript per hold) and mutes the mic. The
   * flushed final transcript arrives asynchronously via
   * `RoomEvent.TranscriptionReceived` and becomes the synthesized tool call.
   */
  async stopTalking(): Promise<void> {
    const room = this.#room;
    if (!room) return;
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: 'turn_end' })),
      { reliable: true, topic: TURN_TOPIC },
    );
    await room.localParticipant.setMicrophoneEnabled(false);
    this.#emit({ type: 'state', state: 'thinking' });
  }

  /** Concrete-only: unlock audio playback after a user gesture. */
  async enableAudio(): Promise<void> {
    await this.#room?.startAudio();
  }

  #wireRoomEvents(room: Room): void {
    room.on(RoomEvent.Disconnected, () => {
      if (this.#room !== room) return;
      this.#emit({ type: 'state', state: 'idle' });
    });
    room.on(RoomEvent.TranscriptionReceived, (segments) => {
      this.#handleTranscription(segments);
    });
    // Publishing the worker's TTS track ≠ hearing it — attach it to a sink.
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      this.#attachAudioTrack(track);
    });
    room.on(RoomEvent.DataReceived, (_payload, _participant, _kind, topic) => {
      if (topic !== TTS_TOPIC) return;
      this.#emit({
        type: 'error',
        error: new Error('LiveKit worker reported a TTS synthesis failure'),
      });
    });
  }

  #handleTranscription(segments: TranscriptionSegment[]): void {
    const finals = segments.filter((s) => s.final);
    if (finals.length === 0) return;
    const text = finals
      .map((s) => s.text)
      .join(' ')
      .trim();
    if (!text) return;

    this.#emit({ type: 'transcript', role: 'user', text, final: true });
    // The spike's core: a cascaded final transcript is turned into the same
    // `update_ui` tool call a speech-native model would emit, so RealtimeSession
    // drives it through the identical path (submitIntent → speak-after-render).
    this.#emit({
      type: 'tool_call',
      callId: this.#nextCallId(),
      name: 'update_ui',
      argumentsJson: JSON.stringify({ intent: text }),
    });
  }

  #nextCallId(): ToolCallId {
    this.#callSeq += 1;
    return ToolCallId(`livekit-${Date.now()}-${this.#callSeq}`);
  }

  #attachAudioTrack(track: RemoteTrack): void {
    if (typeof document === 'undefined') return;
    if (!this.#audioEl) {
      const el = document.createElement('audio');
      el.autoplay = true;
      el.style.display = 'none';
      document.body.appendChild(el);
      this.#audioEl = el;
    }
    track.attach(this.#audioEl);
  }

  #emit(event: RealtimeAdapterEvent): void {
    for (const handler of this.#handlers) handler(event);
  }

  #teardown(): void {
    this.#room = undefined;
    this.#connecting = false;
    if (this.#audioEl) {
      this.#audioEl.remove();
      this.#audioEl = undefined;
    }
  }
}

// RealtimeSession sends update_ui results as `{ ok, summary }`; other tools
// return raw snapshots. We only ever synthesize update_ui, so `summary` is the
// expected shape — fall back to a stringified payload rather than speaking
// nothing if that ever changes.
function extractSummary(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output !== null && typeof output === 'object' && 'summary' in output) {
    const summary = (output as { summary?: unknown }).summary;
    if (typeof summary === 'string') return summary;
  }
  return JSON.stringify(output);
}
