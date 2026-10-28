import { afterEach, expect, spyOn, test } from 'bun:test';
import { captureWebsiteEvent } from './posthog';

const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'window', original);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('an unavailable analytics client does not block onboarding', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });
  expect(() =>
    captureWebsiteEvent('get_started_clicked', { source: 'hero' }),
  ).not.toThrow();
});

test('an analytics failure cannot turn a successful copy into a product failure or log copied content', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      posthog: {
        capture() {
          throw new Error('DO_NOT_LOG_PAYLOAD');
        },
      },
    },
  });
  const warning = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(() =>
      captureWebsiteEvent('setup_copied', { method: 'prompt', source: 'hero' }),
    ).not.toThrow();
    expect(warning).toHaveBeenCalledWith(
      '[website_analytics_failed]',
      'setup_copied',
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain(
      'DO_NOT_LOG_PAYLOAD',
    );
  } finally {
    warning.mockRestore();
  }
});
