import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, setLogLevel } from 'livekit-client';
import type { RemoteTrack } from 'livekit-client';
import type { MaelstromExtension } from '@maelstrom-co/react';
import { SPEAK_TOPIC, TURN_TOPIC } from './protocol.js';
import { defaultSeams } from './seams.js';
import type { ShouldSpeak, SpeakTransport, VoiceSeams } from './seams.js';

// Quiet the livekit-client SDK's verbose signal/connection logging (which dumps
// the full connect URL on every join). Warnings and errors still surface.
setLogLevel('warn');

/**
 * Mints a LiveKit access token + room URL for a room. Injected into
 * `liveKitVoice` so this browser package stays transport-agnostic — the app
 * owns how the token is fetched (a TanStack Start server fn, a plain `fetch`,
 * etc.). Wrap `mintLiveKitToken` from `@maelstrom-co/livekit-voice/server`.
 */
export type GetLiveKitToken = (
  roomName: string,
) => Promise<{ token: string; url: string }>;

/**
 * Voice configuration passed to `setEnabled`. The on/off switch is a field on
 * this object (not a bare boolean) so granular control can be added later as new
 * fields without changing the `setEnabled` signature.
 */
export interface VoiceConfig {
  /**
   * Master voice switch. ON = join the LiveKit room (mic affordance + speak-back).
   * OFF = leave the room → no mic, no TTS.
   */
  enabled: boolean;
}

export interface LiveKitVoiceOptions extends Partial<VoiceSeams> {
  /**
   * Fetches a LiveKit token + URL for a room. Required: the extension has no
   * built-in transport, so the app must supply the token grant (keeps this
   * package free of any server-framework coupling).
   */
  getToken: GetLiveKitToken;
  /**
   * Override the speak-back predicate. Consumed ONLY by the default `onResponse`
   * seam; if `onResponse` is also overridden, `shouldSpeak` has no effect (the
   * override owns the decision).
   */
  shouldSpeak?: ShouldSpeak;
}

export type VoiceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface VoiceAPI {
  status: VoiceStatus;
  currentTranscript: string;
  /** Live mic input level 0..1 (RMS) while talking — 0 when muted/idle. Proves capture. */
  micLevel: number;
  /** Whether the master voice switch is on (room joined / joining). */
  enabled: boolean;
  /** True when the browser is blocking audio playback (needs a gesture to unlock). */
  audioBlocked: boolean;
  /** Last connection error message (e.g. missing credentials), or null when healthy. */
  errorMessage: string | null;
  /** Toggle the master voice switch. Enabling joins the room + unlocks audio. */
  setEnabled: (config: VoiceConfig, roomName: string) => Promise<void>;
  startTalking: () => Promise<void>;
  stopTalking: () => Promise<void>;
  /** Unlock audio playback after a user gesture (the "tap to enable sound" affordance). */
  enableAudio: () => Promise<void>;
}

/**
 * Builds the `speak` transport: sends `userMessage` text to the worker over the
 * `speak` text stream for TTS synthesis. A no-op when no room is joined (voice
 * off), so callers never need to branch on connection state.
 */
export function createSpeakTransport(
  getRoom: () => Room | null,
): SpeakTransport {
  return async (text: string) => {
    const room = getRoom();
    if (!room) return;
    await room.localParticipant.sendText(text, { topic: SPEAK_TOPIC });
  };
}

/**
 * Maelstrom extension adding a `voice` namespace with a `useVoice` hook. Wire it
 * up via `createMaelstrom(...).with(liveKitVoice({ getToken }))`. The browser
 * stays the orchestration hub: agent transcripts drive `processIntent`, and
 * completed responses are spoken back over the `speak` transport.
 */
export function liveKitVoice(
  options: LiveKitVoiceOptions,
): MaelstromExtension<{
  voice: { useVoice: () => VoiceAPI };
}> {
  return (ctx) => {
    return {
      voice: {
        useVoice: (): VoiceAPI => {
          const { orchestrator } = ctx.useMaelstromContext();

          const roomRef = useRef<Room | null>(null);
          const audioElRef = useRef<HTMLAudioElement | null>(null);
          const meterRef = useRef<{
            ctx: AudioContext;
            raf: number;
          } | null>(null);
          const [status, setStatus] = useState<VoiceStatus>('disconnected');
          const [enabled, setEnabledState] = useState(false);
          const [audioBlocked, setAudioBlocked] = useState(false);
          const [errorMessage, setErrorMessage] = useState<string | null>(null);
          const [currentTranscript, setCurrentTranscript] = useState('');
          const [micLevel, setMicLevel] = useState(0);

          // Create the speak transport once (lazy-init ref): its closure over
          // roomRef never changes, so it must not be rebuilt each render.
          const speakRef = useRef<SpeakTransport | null>(null);
          if (speakRef.current === null) {
            speakRef.current = createSpeakTransport(() => roomRef.current);
          }

          const defaults = defaultSeams(
            orchestrator,
            (text) => speakRef.current!(text),
            options.shouldSpeak,
          );
          const seams = useRef<VoiceSeams>(defaults);
          // Keep seams ref current — options are stable (closed over at factory time)
          seams.current = {
            onTranscript: options.onTranscript ?? defaults.onTranscript,
            onResponse: options.onResponse ?? defaults.onResponse,
          };

          // Observe completed responses (read-only) → speak via onResponse seam.
          // This does NOT alter response application; the existing pipeline
          // applies layout + actions exactly as before. Subscribed once for the
          // hook's lifetime; the seams ref keeps the latest closure current.
          useEffect(() => {
            const off = orchestrator.requestCoordinator.events.on(
              'processing_completed',
              (e) => {
                void Promise.resolve(seams.current.onResponse(e.response)).catch(
                  (err) =>
                    console.error('[liveKitVoice] onResponse failed', err),
                );
              },
            );
            return off;
          }, [orchestrator]);

          useEffect(() => {
            return () => {
              stopMetering();
              roomRef.current?.disconnect();
            };
          }, []);

          const connect = useCallback(async (roomName: string) => {
            if (roomRef.current) return;

            // Claim the slot synchronously, before any await, so a concurrent
            // call (e.g. React StrictMode double-invoking the auto-join effect)
            // sees roomRef set and returns instead of opening a second room.
            const room = new Room();
            roomRef.current = room;
            setStatus('connecting');
            setErrorMessage(null);

            room.on(RoomEvent.Connected, () => setStatus('connected'));
            room.on(RoomEvent.Disconnected, () => {
              // Ignore a superseded room's late Disconnected — only the active
              // room may clear the ref.
              if (roomRef.current !== room) return;
              roomRef.current = null;
              setStatus('disconnected');
            });
            room.on(RoomEvent.Reconnecting, () => setStatus('connecting'));
            room.on(RoomEvent.Reconnected, () => setStatus('connected'));

            room.on(RoomEvent.TranscriptionReceived, (segments) => {
              const finals = segments.filter((s) => s.final);
              if (finals.length === 0) return;
              const text = finals
                .map((s) => s.text)
                .join(' ')
                .trim();
              if (!text) return;
              setCurrentTranscript(text);
              void Promise.resolve(seams.current.onTranscript(text)).catch(
                (err) => console.error('[liveKitVoice] onTranscript failed', err),
              );
            });

            // Attach the agent's TTS audio track to a hidden sink so it plays.
            room.on(RoomEvent.TrackSubscribed, (track) => {
              if (track.kind !== Track.Kind.Audio) return;
              attachAudioTrack(track, audioElRef);
            });

            // Surface the conditional "tap to enable sound" affordance only
            // when the browser actually blocks playback.
            room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
              setAudioBlocked(!room.canPlaybackAudio);
            });

            try {
              const { token, url } = await options.getToken(roomName);

              await room.connect(url, token);
              // Publish the mic track, then mute it via the SAME API used by
              // start/stopTalking. Muting through setMicrophoneEnabled (not a
              // direct track.mute()) keeps the publication's enabled flag in
              // sync, so startTalking's setMicrophoneEnabled(true) is a real
              // false→true toggle that actually unmutes. A direct track.mute()
              // leaves the publication "enabled", making the later enable a
              // silent no-op — the mic would never reopen.
              await room.localParticipant.setMicrophoneEnabled(true);
              await room.localParticipant.setMicrophoneEnabled(false);

              // Proactive return-visit detection: read canPlaybackAudio right
              // after join (LiveKit reports the blocked state silently, before
              // any real TTS) so the prompt shows up front when needed.
              setAudioBlocked(!room.canPlaybackAudio);
            } catch (err) {
              console.error('[liveKitVoice] connect failed', err);
              // Tear down the orphaned room; only clear the ref + flag error if
              // this room is still the active one (a newer connect may have
              // superseded it).
              void room.disconnect();
              if (roomRef.current === room) {
                roomRef.current = null;
                setStatus('error');
                setErrorMessage(
                  err instanceof Error ? err.message : String(err),
                );
              }
            }
          }, []);

          const disconnect = useCallback(async () => {
            try {
              await roomRef.current?.disconnect();
            } finally {
              roomRef.current = null;
              setStatus('disconnected');
            }
          }, []);

          const enableAudio = useCallback(async () => {
            const room = roomRef.current;
            if (!room) return;
            try {
              await room.startAudio();
              setAudioBlocked(!room.canPlaybackAudio);
            } catch (err) {
              console.error('[liveKitVoice] startAudio failed', err);
              // Surface the "tap to enable sound" affordance so the user has a
              // recovery path when the unlock attempt fails.
              setAudioBlocked(true);
            }
          }, []);

          // Master voice switch. Enabling joins the room AND unlocks audio in the
          // same user gesture (so playback is unlocked, no prompt in the normal
          // flow). Disabling leaves the room.
          const setEnabled = useCallback(
            async (config: VoiceConfig, roomName: string) => {
              if (config.enabled) {
                await connect(roomName);
                // Flip the master switch on only once a room actually connected,
                // so a failed connect leaves enabled=false instead of an ON
                // toggle sitting over an 'error' status.
                if (roomRef.current) {
                  setEnabledState(true);
                  await enableAudio();
                } else {
                  setEnabledState(false);
                }
              } else {
                setEnabledState(false);
                await disconnect();
              }
            },
            [connect, disconnect, enableAudio],
          );

          // Tap the live mic MediaStreamTrack with a Web Audio analyser and
          // publish its RMS as micLevel each frame. Gives the UI a direct,
          // pipeline-independent "the browser is hearing you" signal.
          const startMetering = useCallback(
            (mediaStreamTrack: MediaStreamTrack) => {
              stopMetering();
              const Ctx =
                window.AudioContext ??
                (
                  window as unknown as {
                    webkitAudioContext: typeof AudioContext;
                  }
                ).webkitAudioContext;
              const ctx = new Ctx();
              const source = ctx.createMediaStreamSource(
                new MediaStream([mediaStreamTrack]),
              );
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 256;
              source.connect(analyser);
              const data = new Uint8Array(analyser.fftSize);
              const tick = () => {
                analyser.getByteTimeDomainData(data);
                let sum = 0;
                for (const v of data) {
                  const x = (v - 128) / 128;
                  sum += x * x;
                }
                setMicLevel(Math.sqrt(sum / data.length));
                const raf = requestAnimationFrame(tick);
                if (meterRef.current) meterRef.current.raf = raf;
              };
              meterRef.current = { ctx, raf: requestAnimationFrame(tick) };
            },
            [],
          );

          const startTalking = useCallback(async () => {
            const room = roomRef.current;
            if (!room) return;
            await room.localParticipant.setMicrophoneEnabled(true);
            const mst = [
              ...room.localParticipant.trackPublications.values(),
            ].find((p) => p.kind === 'audio')?.track?.mediaStreamTrack;
            if (mst) startMetering(mst);
          }, [startMetering]);

          const stopTalking = useCallback(async () => {
            stopMetering();
            setMicLevel(0);
            const room = roomRef.current;
            if (!room) return;
            // Signal the agent to flush its STT buffer
            const encoder = new TextEncoder();
            await room.localParticipant.publishData(
              encoder.encode(JSON.stringify({ type: 'turn_end' })),
              { reliable: true, topic: TURN_TOPIC },
            );
            await room.localParticipant.setMicrophoneEnabled(false);
          }, []);

          // Stop the analyser loop + free the AudioContext. Stable identity
          // (no deps) so startTalking/cleanup can call it without churn.
          function stopMetering() {
            const meter = meterRef.current;
            if (!meter) return;
            cancelAnimationFrame(meter.raf);
            void meter.ctx.close();
            meterRef.current = null;
          }

          return {
            status,
            currentTranscript,
            micLevel,
            enabled,
            audioBlocked,
            errorMessage,
            setEnabled,
            startTalking,
            stopTalking,
            enableAudio,
          };
        },
      },
    };
  };
}

// Owns a hidden <audio> sink and attaches the agent's TTS track to it. Publishing
// a track ≠ hearing it — the track must be attached to a media element to play.
function attachAudioTrack(
  track: RemoteTrack,
  sinkRef: { current: HTMLAudioElement | null },
): void {
  if (typeof document === 'undefined') return;
  if (!sinkRef.current) {
    const el = document.createElement('audio');
    el.autoplay = true;
    el.style.display = 'none';
    document.body.appendChild(el);
    sinkRef.current = el;
  }
  track.attach(sinkRef.current);
}
