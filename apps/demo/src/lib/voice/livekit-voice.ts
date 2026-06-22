import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import type { MaelstromExtension } from '@maelstrom-co/react';
import { getLivekitToken } from './get-livekit-token';
import { defaultSeams } from './seams';
import type { VoiceSeams } from './seams';

export interface LiveKitVoiceOptions extends Partial<VoiceSeams> {}

export type VoiceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface VoiceAPI {
  status: VoiceStatus;
  currentTranscript: string;
  connect: (roomName: string) => Promise<void>;
  disconnect: () => Promise<void>;
  startTalking: () => Promise<void>;
  stopTalking: () => Promise<void>;
}

export function liveKitVoice(options: LiveKitVoiceOptions = {}): MaelstromExtension<{
  voice: { useVoice: () => VoiceAPI };
}> {
  return (ctx) => {
    return {
      voice: {
        useVoice: (): VoiceAPI => {
          const { orchestrator } = ctx.useMaelstromContext();

          const defaults = defaultSeams(orchestrator);
          const seams = useRef<VoiceSeams>(defaults);
          // Keep seams ref current — options are stable (closed over at factory time)
          seams.current = {
            onTranscript: options.onTranscript ?? defaults.onTranscript,
            onResponse: options.onResponse ?? defaults.onResponse,
          };

          const roomRef = useRef<Room | null>(null);
          const [status, setStatus] = useState<VoiceStatus>('disconnected');
          const [currentTranscript, setCurrentTranscript] = useState('');

          useEffect(() => {
            return () => {
              roomRef.current?.disconnect();
            };
          }, []);

          const connect = useCallback(async (roomName: string) => {
            if (roomRef.current) return;

            setStatus('connecting');
            try {
              const { token, url } = await getLivekitToken({ data: { roomName } });

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
                const text = finals.map((s) => s.text).join(' ').trim();
                if (!text) return;
                setCurrentTranscript(text);
                void seams.current.onTranscript(text);
              });

              await room.connect(url, token);
              // Publish mic track muted — unmute on startTalking
              await room.localParticipant.setMicrophoneEnabled(true);
              const micTrack = [...room.localParticipant.trackPublications.values()].find(
                (p) => p.kind === 'audio',
              );
              if (micTrack?.track) {
                await micTrack.track.mute();
              }
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

          return { status, currentTranscript, connect, disconnect, startTalking, stopTalking };
        },
      },
    };
  };
}
