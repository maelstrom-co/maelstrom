import { describe, expect, it } from 'bun:test';
import { MaelstromError } from '@maelstrom-co/protocol';
import { RealtimeVoiceError } from './realtime-voice-error.js';

describe('RealtimeVoiceError', () => {
  it('is a MaelstromError with a narrowed code and preserved cause', () => {
    const cause = new Error('boom');
    const err = new RealtimeVoiceError('TOKEN_MINT_FAILED', 'mint failed', cause);

    expect(err).toBeInstanceOf(MaelstromError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('TOKEN_MINT_FAILED');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('RealtimeVoiceError');
  });
});
