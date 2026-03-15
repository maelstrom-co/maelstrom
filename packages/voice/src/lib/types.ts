import type { EngineConnector } from '@maelstrom/client';
import type {
  VoiceClientMessage,
  VoiceServerMessage,
} from '@maelstrom/protocol';

export type { EngineConnector } from '@maelstrom/client';

export type VoiceSessionState = 'idle' | 'listening' | 'silence' | 'speaking';

export interface AudioChunk {
  data: Uint8Array;
  sampleRate: number;
  encoding: string;
  isFinal: boolean;
}

/**
 * Metadata extracted from the 1-byte flags header of binary audio frames.
 */
export interface AudioFrameMeta {
  /** Whether this audio can be interrupted by user barge-in */
  cancellable: boolean;
}

/** Audio frame flags byte layout */
export const AUDIO_FRAME_FLAGS = {
  /** Bit 0: cancellable flag (1 = interruptible, 0 = must play fully) */
  CANCELLABLE: 0b00000001,
} as const;

export interface VoiceConnector extends EngineConnector {
  sendAudioChunk(chunk: AudioChunk): void;
  startListening(language?: string, interimResults?: boolean): void;
  stopListening(): void;
  onVoiceMessage(callback: (message: VoiceServerMessage) => void): () => void;
  onBinaryAudio(
    callback: (data: Uint8Array, meta: AudioFrameMeta) => void,
  ): () => void;
  sendVoiceMessage(message: VoiceClientMessage): void;
}

export function isVoiceConnector(
  connector: EngineConnector,
): connector is VoiceConnector {
  return (
    'sendAudioChunk' in connector &&
    'startListening' in connector &&
    'stopListening' in connector &&
    'onVoiceMessage' in connector &&
    'onBinaryAudio' in connector &&
    'sendVoiceMessage' in connector
  );
}
