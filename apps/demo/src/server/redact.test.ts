import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact';

describe('redactSecrets', () => {
  it('scrubs every occurrence of the exact api key wherever it appears in a JSON-encoded envelope', () => {
    const apiKey = 'sk-live-abc123def456';
    const wire = JSON.stringify({
      type: 'engine.error',
      error: `request failed twice: first with key ${apiKey}, then retried and failed again with key ${apiKey}`,
    });

    const result = redactSecrets(wire, apiKey);

    expect(result).not.toContain(apiKey);
    expect(result.match(/\[redacted\]/g)).toHaveLength(2);
  });

  it('scrubs sk-* shaped substrings even when they are not the session key', () => {
    // Provider SDKs sometimes echo a masked/partial form of the key that
    // differs byte-for-byte from what the session was created with (e.g.
    // truncated for display). Exact-match alone would miss this.
    const wire = JSON.stringify({
      type: 'engine.error',
      error: 'Incorrect API key provided: sk-proj-abc...xyz. You can find your API key at...',
    });

    const result = redactSecrets(wire, 'sk-live-the-actual-session-key');

    expect(result).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    expect(result).toContain('[redacted]');
  });

  it('passes through a wire string with no secrets unchanged', () => {
    const wire = JSON.stringify({ type: 'chart.response', requestId: 'req-1', ok: true });

    const result = redactSecrets(wire, 'sk-live-abc123def456');

    expect(result).toBe(wire);
  });

  it('still applies the pattern pass when apiKey is empty or undefined', () => {
    const wireWithLeak = JSON.stringify({
      type: 'engine.error',
      error: 'unexpected token near sk-somehow-leaked-anyway-1234',
    });

    expect(redactSecrets(wireWithLeak, '')).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    expect(redactSecrets(wireWithLeak, undefined)).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
  });

  it('strips the session key out of a realistic encoded engine.error envelope (401 echo)', () => {
    // This is the exact failure mode the design guards against: the OpenAI
    // SDK's 401 message for a bad/revoked key echoes the key back, and that
    // message flows unmodified into EngineErrorMessage.error and out over
    // the wire via encodeEnvelope. If redaction stops covering error
    // payloads, this test must fail.
    const apiKey = 'sk-live-thisIsTheSessionsRealApiKey0000';
    const engineErrorEnvelope = {
      type: 'engine.error',
      requestId: 'req-42',
      sessionId: 'session-abc',
      error:
        `401 Incorrect API key provided: ${apiKey}. ` +
        'You can find your API key at https://platform.openai.com/account/api-keys.',
    };
    const wire = JSON.stringify(engineErrorEnvelope);

    const result = redactSecrets(wire, apiKey);

    expect(result).not.toContain(apiKey);
    expect(JSON.parse(result).error).toContain('[redacted]');
  });
});
