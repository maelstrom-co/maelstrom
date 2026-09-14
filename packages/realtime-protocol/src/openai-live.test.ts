import { expect, test } from 'bun:test';
import { LiveSessionConfigSchema, LiveTransportError } from './openai-live.js';

test('startup recovery accepts text roles but rejects executable history and bounds provider context cost', () => {
  const session = {
    model: 'live',
    delegation: { type: 'responses', responses: { model: 'backend' } },
  };
  const message = (role: string, type: string, text: string) => ({
    type: 'message',
    role,
    content: [{ type, text }],
  });
  expect(
    LiveSessionConfigSchema.safeParse({
      ...session,
      input: [
        message('user', 'input_text', 'Observed data'),
        message('assistant', 'output_text', 'Observed speech'),
      ],
    }).success,
  ).toBe(true);
  for (const input of [
    [
      {
        type: 'function_call',
        call_id: 'old',
        name: 'update_ui',
        arguments: '{}',
      },
    ],
    [message('system', 'input_text', 'Escalated instructions')],
    [message('assistant', 'input_text', 'Wrong role encoding')],
    [message('user', 'input_text', '😀'.repeat(2049))],
    Array.from({ length: 129 }, () => message('user', 'input_text', '')),
  ])
    expect(
      LiveSessionConfigSchema.safeParse({ ...session, input }).success,
    ).toBe(false);
});

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
