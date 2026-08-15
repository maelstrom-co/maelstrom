import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHosted, usesBrowserKey } from './hosted-mode';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isHosted', () => {
  it('is false when VITE_HOSTED is unset', () => {
    vi.stubEnv('VITE_HOSTED', undefined);
    expect(isHosted()).toBe(false);
  });

  it('is true when VITE_HOSTED is exactly "1"', () => {
    vi.stubEnv('VITE_HOSTED', '1');
    expect(isHosted()).toBe(true);
  });

  it('is false for any other value', () => {
    vi.stubEnv('VITE_HOSTED', 'true');
    expect(isHosted()).toBe(false);
  });
});

describe('usesBrowserKey', () => {
  it('is true for hosted deployments', () => {
    vi.stubEnv('VITE_HOSTED', '1');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
    expect(usesBrowserKey()).toBe(true);
  });

  it('is true on localhost when the server has no OpenAI key', () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
    expect(usesBrowserKey()).toBe(true);
  });

  it('is false on localhost when the server owns an OpenAI key', () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
    expect(usesBrowserKey()).toBe(false);
  });
});
