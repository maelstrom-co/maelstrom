import { describe, expect, it } from 'bun:test';
import { SessionId } from './session.js';
import { SidechannelEventSchema } from './sidechannel-event.js';

const base = { sessionId: SessionId('sess-1'), at: 1712345678000 };

describe('SidechannelEventSchema', () => {
  it('accepts a final user transcript', () => {
    const e = SidechannelEventSchema.parse({
      ...base, type: 'transcript', role: 'user', text: 'show labs', final: true,
    });
    expect(e.type).toBe('transcript');
  });

  it('accepts a tool_call event', () => {
    const e = SidechannelEventSchema.parse({
      ...base, type: 'tool_call', name: 'update_ui', callId: 'call_1',
      argumentsJson: '{"intent":"show labs"}',
    });
    if (e.type === 'tool_call') expect(e.name).toBe('update_ui');
  });

  it('accepts a tool_result event with measured latency', () => {
    const e = SidechannelEventSchema.parse({
      ...base, type: 'tool_result', callId: 'call_1', ok: true, latencyMs: 42,
    });
    if (e.type === 'tool_result') expect(e.latencyMs).toBe(42);
  });

  it('accepts a timing event', () => {
    const e = SidechannelEventSchema.parse({
      ...base, type: 'timing', label: 'render', ms: 12,
    });
    if (e.type === 'timing') expect(e.ms).toBe(12);
  });

  it('rejects an unknown event type', () => {
    expect(() => SidechannelEventSchema.parse({ ...base, type: 'audio' })).toThrow();
  });

  it('rejects a negative tool_result latency', () => {
    expect(() =>
      SidechannelEventSchema.parse({
        ...base, type: 'tool_result', callId: 'c', ok: false, latencyMs: -1,
      }),
    ).toThrow();
  });

  // Default (strip) mode is deliberate: the contract is additive-only, so old
  // receivers must tolerate new fields. Unknown fields must still be dropped
  // on parse, or an accidental addition (e.g. a raw payload) would silently
  // leak through instead of being caught at the schema boundary.
  it('strips unknown fields from a transcript event instead of preserving them', () => {
    const e = SidechannelEventSchema.parse({
      ...base, type: 'transcript', role: 'user', text: 'show labs', final: true,
      requestId: 'req-123', rawPayload: { audio: 'base64...' }, extras: { foo: 'bar' },
    });
    expect(Object.keys(e).sort()).toEqual(
      ['at', 'final', 'role', 'sessionId', 'text', 'type'].sort(),
    );
  });

  it('strips unknown fields from a tool_call event instead of preserving them', () => {
    const e = SidechannelEventSchema.parse({
      ...base, type: 'tool_call', name: 'update_ui', callId: 'call_1',
      argumentsJson: '{"intent":"show labs"}',
      requestId: 'req-123', rawPayload: { audio: 'base64...' }, extras: { foo: 'bar' },
    });
    expect(Object.keys(e).sort()).toEqual(
      ['argumentsJson', 'at', 'callId', 'name', 'sessionId', 'type'].sort(),
    );
  });
});
