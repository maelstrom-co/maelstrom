import { describe, expect, it } from 'bun:test';

import { MessageId } from './message.js';

describe('MessageId', () => {
  it('generates a unique id when called with no arguments', () => {
    const id = MessageId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('preserves the provided value when rehydrating', () => {
    const id = MessageId('msg-42');
    expect(id).toBe('msg-42' as ReturnType<typeof MessageId>);
  });

  it('produces different ids across calls without arguments', () => {
    const a = MessageId();
    const b = MessageId();
    expect(a).not.toBe(b);
  });
});
