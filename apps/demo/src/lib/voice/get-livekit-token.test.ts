import { expect, it } from 'bun:test';
import { inputSchema } from './get-livekit-token.js';

// createServerFn's returned function only behaves as a plain call outside
// the TanStack Start server runtime — invoking it directly in a unit test
// resolves to undefined regardless of input. The validator's own schema is
// what encodes the trust-boundary behavior, so it's tested directly here.

it('rejects a missing roomName', () => {
  expect(() => inputSchema.parse({})).toThrow();
});

it('rejects a non-string roomName', () => {
  expect(() => inputSchema.parse({ roomName: 42 })).toThrow();
});

it('rejects a whitespace-only roomName', () => {
  expect(() => inputSchema.parse({ roomName: '   ' })).toThrow('roomName must be a non-empty string');
});

it('trims a roomName with surrounding whitespace', () => {
  expect(inputSchema.parse({ roomName: '  room  ' })).toEqual({ roomName: 'room' });
});

it('accepts an optional identity alongside a valid roomName', () => {
  expect(inputSchema.parse({ roomName: 'room', identity: 'alice' })).toEqual({
    roomName: 'room',
    identity: 'alice',
  });
});
