import { expect, test } from 'bun:test';
import { LiveTransportError } from './openai-live.js';

test('diagnostic correlation preserves printable opaque IDs without truncating them into different IDs', () => {
  const options = {
    requestId: 'req:opaque/123',
    providerCode: null,
    clientEventId: 'evt_日本語-123',
  };
  expect(new LiveTransportError('provider_rejected', options)).toMatchObject(
    options,
  );
});

test.each([
  'x'.repeat(257),
  'unsafe\nvalue',
  'unsafe\u007fvalue',
  'unsafe\u0085value',
  'unsafe\u202evalue',
])('diagnostic correlation omits oversized or control-bearing fields: %j', (value) => {
  const error = new LiveTransportError('provider_rejected', {
    requestId: value,
    providerCode: value,
    clientEventId: value,
  });
  expect(error.requestId).toBeUndefined();
  expect(error.providerCode).toBeUndefined();
  expect(error.clientEventId).toBeUndefined();
});
