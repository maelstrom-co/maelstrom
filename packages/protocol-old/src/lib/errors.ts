export type VoiceErrorCode =
  | 'MICROPHONE_DENIED'
  | 'STT_FAILED'
  | 'TTS_FAILED'
  | 'CONNECTION_LOST'
  | 'TIMEOUT'
  | 'UNKNOWN';

export class MaelstromError extends Error {
  public readonly code: string;
  public override readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'MaelstromError';
    this.code = code;
    this.cause = cause;
  }
}

export class VoiceError extends MaelstromError {
  constructor(code: VoiceErrorCode, message: string, cause?: unknown) {
    super(code, message, cause);
    this.name = 'VoiceError';
  }
}
