import { expect, it } from 'vitest';
import { createLocalLiveAccess } from './local-live-access';

const password = 'fixture-local-password-not-a-provider-key';
const headers = new Headers({
  authorization: `Basic ${Buffer.from(`maelstrom:${password}`).toString('base64')}`,
  origin: 'http://localhost:3000',
  'sec-fetch-site': 'same-origin',
  host: 'localhost:3000',
});
const loopback = { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' };

it('requires explicit local mode and refuses hosted mode even with valid credentials and local peers', () => {
  for (const options of [
    { enabled: false, hosted: false },
    { enabled: true, hosted: true },
  ])
    expect(
      createLocalLiveAccess({ ...options, password })(headers, loopback),
    ).toBe(false);
  expect(() => createLocalLiveAccess({ enabled: true, hosted: false })).toThrow(
    'DEMO_LOCAL_PASSWORD',
  );
});

it('uses native peer addresses rather than forged Host, Origin, or forwarded headers', () => {
  const authorize = createLocalLiveAccess({
    enabled: true,
    hosted: false,
    password,
  });
  expect(
    authorize(headers, { ...loopback, remoteAddress: '203.0.113.5' }),
  ).toBe(false);
  expect(authorize(headers, { ...loopback, localAddress: '192.0.2.4' })).toBe(
    false,
  );
  expect(authorize(headers, {})).toBe(false);
  expect(authorize(headers, loopback)).toBe(true);
});

it('does not grant a tunnel proxy or local caller access from forgeable same-origin headers alone', () => {
  const authorize = createLocalLiveAccess({
    enabled: true,
    hosted: false,
    password,
  });
  const forged = new Headers(headers);
  forged.delete('authorization');
  expect(authorize(forged, loopback)).toBe(false);
  forged.set('authorization', 'Basic Zm9yZ2Vk');
  expect(authorize(forged, loopback)).toBe(false);
});
