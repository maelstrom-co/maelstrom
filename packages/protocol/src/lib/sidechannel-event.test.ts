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

  it('rejects an unknown event type', () => {
    expect(() => SidechannelEventSchema.parse({ ...base, type: 'audio' })).toThrow();
  });
});
