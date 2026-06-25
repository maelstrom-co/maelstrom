import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, setLogLevel } from 'livekit-client';
import type { RemoteTrack } from 'livekit-client';
import type { MaelstromExtension } from '@maelstrom-co/react';
import { getLivekitToken } from './get-livekit-token';
import { defaultSeams } from './seams';
import type { ShouldSpeak, SpeakTransport, VoiceSeams } from './seams';

// Quiet the livekit-client SDK's verbose signal/connection logging (which dumps
// the full connect URL on every join). Warnings and errors still surface.
setLogLevel('warn');

/** Text-stream topic the client uses to send TTS requests to the worker. */
export const SPEAK_TOPIC = 'speak';

/**
 * Voice configuration. The on/off switch is a FIELD on this object (never a
 * bare boolean) so granular control later (`{ input, output, perVessel? }`) is
 * "add fields", not a breaking signature change.
 */
export interface VoiceConfig {
  /**
   * Master voice switch. ON = join the LiveKit room (mic affordance + speak-back;
   * the worker auto-dispatches on join, so TTS is present even when typing).
   * OFF = don't join → no mic, no TTS.
   */
  enabled: boolean;
}

export interface LiveKitVoiceOptions extends Partial<VoiceSeams> {
  /** Override the global speak-back predicate (default: speak every non-empty userMessage). */
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
  /** Toggle the master voice switch. Enabling joins the room + unlocks audio. */
  setEnabled: (enabled: boolean, roomName: string) => Promise<void>;
  connect: (roomName: string) => Promise<void>;
  disconnect: () => Promise<void>;
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

export function liveKitVoice(
  options: LiveKitVoiceOptions = {},
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
          const [currentTranscript, setCurrentTranscript] = useState('');
          const [micLevel, setMicLevel] = useState(0);

          const speak = useRef<SpeakTransport>(
            createSpeakTransport(() => roomRef.current),
          );

          const defaults = defaultSeams(
            orchestrator,
            (text) => speak.current(text),
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
                void seams.current.onResponse(e.response);
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
              void seams.current.onTranscript(text);
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
              const { token, url } = await getLivekitToken({
                data: { roomName },
              });

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
              }
            }
          }, []);

          const disconnect = useCallback(async () => {
            await roomRef.current?.disconnect();
            roomRef.current = null;
            setStatus('disconnected');
          }, []);

          const enableAudio = useCallback(async () => {
            const room = roomRef.current;
            if (!room) return;
            try {
              await room.startAudio();
              setAudioBlocked(!room.canPlaybackAudio);
            } catch (err) {
              console.error('[liveKitVoice] startAudio failed', err);
            }
          }, []);

          // Master voice switch. Enabling joins the room AND unlocks audio in the
          // same user gesture (so playback is unlocked, no prompt in the normal
          // flow). Disabling leaves the room.
          const setEnabled = useCallback(
            async (next: boolean, roomName: string) => {
              setEnabledState(next);
              if (next) {
                await connect(roomName);
                await enableAudio();
              } else {
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
              { reliable: true, topic: 'turn' },
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
            setEnabled,
            connect,
            disconnect,
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
