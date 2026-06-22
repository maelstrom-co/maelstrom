import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import type { RemoteTrack } from 'livekit-client';
import type { MaelstromExtension } from '@maelstrom-co/react';
import { getLivekitToken } from './get-livekit-token';
import { defaultSeams } from './seams';
import type { ShouldSpeak, SpeakTransport, VoiceSeams } from './seams';

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
          const [status, setStatus] = useState<VoiceStatus>('disconnected');
          const [enabled, setEnabledState] = useState(false);
          const [audioBlocked, setAudioBlocked] = useState(false);
          const [currentTranscript, setCurrentTranscript] = useState('');

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
              roomRef.current?.disconnect();
            };
          }, []);

          const connect = useCallback(async (roomName: string) => {
            if (roomRef.current) return;

            setStatus('connecting');
            try {
              const { token, url } = await getLivekitToken({
                data: { roomName },
              });

              const room = new Room();
              roomRef.current = room;

              room.on(RoomEvent.Connected, () => setStatus('connected'));
              room.on(RoomEvent.Disconnected, () => {
                setStatus('disconnected');
                roomRef.current = null;
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

              await room.connect(url, token);
              // Publish mic track muted — unmute on startTalking
              await room.localParticipant.setMicrophoneEnabled(true);
              const micTrack = [
                ...room.localParticipant.trackPublications.values(),
              ].find((p) => p.kind === 'audio');
              if (micTrack?.track) {
                await micTrack.track.mute();
              }

              // Proactive return-visit detection: read canPlaybackAudio right
              // after join (LiveKit reports the blocked state silently, before
              // any real TTS) so the prompt shows up front when needed.
              setAudioBlocked(!room.canPlaybackAudio);
            } catch (err) {
              console.error('[liveKitVoice] connect failed', err);
              roomRef.current = null;
              setStatus('error');
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

          const startTalking = useCallback(async () => {
            const room = roomRef.current;
            if (!room) return;
            await room.localParticipant.setMicrophoneEnabled(true);
          }, []);

          const stopTalking = useCallback(async () => {
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

          return {
            status,
            currentTranscript,
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
