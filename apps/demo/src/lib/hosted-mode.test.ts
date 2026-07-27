import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHosted } from './hosted-mode';

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
