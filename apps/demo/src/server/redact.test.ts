import { nanoid } from 'nanoid';
import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact';

// nanoid's default alphabet is `A-Za-z0-9_-` at length 21 — the same
// character class the pattern pass scans for a key shape, so any nanoid
// that happens to contain "sk-" is a latent collision with the pattern pass.
const NANOID_LENGTH = 21;

/** Forces "sk-" into a real generated nanoid at a given offset, keeping every other character genuine. */
function nanoidWithEmbeddedMarker(offset: number): string {
  const id = nanoid();
  return `${id.slice(0, offset)}sk-${id.slice(offset + 3)}`;
}

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
    // Provider SDKs sometimes echo a full key-shaped string that differs
    // byte-for-byte from what the session was created with (e.g. a
    // pre-rotation key baked into a cached client). Exact-match alone would
    // miss this, so the string must be at least as long as a real key
    // (see the length-floor tests below) or this scenario is untestable.
    const echoedKey = `sk-proj-${'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOp'}`;
    const wire = JSON.stringify({
      type: 'engine.error',
      error: `Incorrect API key provided: ${echoedKey}. You can find your API key at...`,
    });

    const result = redactSecrets(wire, 'sk-live-the-actual-session-key');

    expect(result).not.toContain(echoedKey);
    expect(result).toContain('[redacted]');
  });

  it('passes through a wire string with no secrets unchanged', () => {
    const wire = JSON.stringify({ type: 'chart.response', requestId: 'req-1', ok: true });

    const result = redactSecrets(wire, 'sk-live-abc123def456');

    expect(result).toBe(wire);
  });

  it('still applies the pattern pass when apiKey is empty or undefined', () => {
    const leakedKey = 'sk-leaked9876Anyway1234FromADifferentSessionEntirely';
    const wireWithLeak = JSON.stringify({
      type: 'engine.error',
      error: `unexpected token near ${leakedKey}`,
    });

    expect(redactSecrets(wireWithLeak, '')).not.toContain(leakedKey);
    expect(redactSecrets(wireWithLeak, undefined)).not.toContain(leakedKey);
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

  it('leaves a nanoid-shaped protocol id embedding "sk-" byte-for-byte intact', () => {
    // Protocol message/instance ids are nanoid() — alphabet `A-Za-z0-9_-`,
    // length 21 — which occasionally contains "sk-" as a substring. If the
    // pattern pass mangles it, a mangled requestId breaks the client's
    // RequestCorrelator (the visitor's request hangs to timeout) and a
    // mangled instance id in a layout points at a vessel that no longer
    // exists. Neither id is a secret; both must survive verbatim.
    const requestId = nanoidWithEmbeddedMarker(4);
    const wire = JSON.stringify({
      type: 'chart.response',
      requestId,
      ok: true,
    });

    const result = redactSecrets(wire, undefined);

    expect(result).toBe(wire);
    expect(JSON.parse(result).requestId).toBe(requestId);
  });

  it('cannot match any nanoid regardless of where "sk-" falls inside it', () => {
    // This encodes the actual safety argument for the {32,} floor rather
    // than just one hand-picked example: a nanoid is 21 characters total,
    // so even with "sk-" at the very start there are at most 18 trailing
    // alphabet characters — never enough to satisfy a 32+-char run. Sweeping
    // every valid offset (0..18) proves the pattern can't match a nanoid no
    // matter where the marker lands, so this stays true even if a future
    // edit shrinks the floor accidentally for one offset but not others.
    for (let offset = 0; offset <= NANOID_LENGTH - 3; offset++) {
      const id = nanoidWithEmbeddedMarker(offset);
      expect(id).toHaveLength(NANOID_LENGTH);

      const wire = JSON.stringify({ type: 'chart.response', requestId: id, ok: true });
      const result = redactSecrets(wire, undefined);

      expect(result).toBe(wire);
    }
  });

  it('still redacts a real classic-format leaked key (sk- + 48 chars, 51 total)', () => {
    // Verified against OpenAI's legacy key format: "sk-" followed by 48
    // alphanumeric characters, 51 characters total — the shortest real
    // OpenAI key shape in circulation. It must clear the {32,} floor with
    // margin, or the pattern pass would miss genuine leaked keys.
    const classicKey = `sk-${'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV'}`;
    expect(classicKey).toHaveLength(51);
    const wire = JSON.stringify({ type: 'engine.error', error: `leaked: ${classicKey}` });

    const result = redactSecrets(wire, undefined);

    expect(result).not.toContain(classicKey);
    expect(result).toContain('[redacted]');
  });

  it('still redacts a real sk-proj- format leaked key (56+ chars total)', () => {
    // Verified against OpenAI's current project-scoped key format:
    // "sk-proj-" followed by a long base64url payload (~48 chars in the
    // mid-2024 rollout, ~155 chars in the current one) — comfortably clear
    // of the {32,} floor in either generation.
    const projKey = `sk-proj-${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V2w3X4y5Z6'}`;
    expect(projKey.length).toBeGreaterThanOrEqual(56);
    const wire = JSON.stringify({ type: 'engine.error', error: `leaked: ${projKey}` });

    const result = redactSecrets(wire, undefined);

    expect(result).not.toContain(projKey);
    expect(result).toContain('[redacted]');
  });
});
