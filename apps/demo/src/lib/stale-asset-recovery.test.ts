import { describe, expect, it, vi } from 'vitest';
import { installStaleAssetRecovery } from './stale-asset-recovery';

describe('installStaleAssetRecovery', () => {
  function storage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
  }

  it('reloads once for the current entry and suppresses that import failure', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    installStaleAssetRecovery(target, {
      storage: storage(),
      entryUrl: '/assets/index-a.js',
      reload,
    });

    const first = new Event('vite:preloadError', { cancelable: true });
    const second = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(first);
    target.dispatchEvent(second);

    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('allows a later entry to recover in the same tab', () => {
    const sharedStorage = storage();
    const firstReload = vi.fn();
    const firstTarget = new EventTarget();
    installStaleAssetRecovery(firstTarget, {
      storage: sharedStorage,
      entryUrl: '/assets/index-a.js',
      reload: firstReload,
    });
    firstTarget.dispatchEvent(
      new Event('vite:preloadError', { cancelable: true }),
    );

    const nextReload = vi.fn();
    const nextTarget = new EventTarget();
    installStaleAssetRecovery(nextTarget, {
      storage: sharedStorage,
      entryUrl: '/assets/index-b.js',
      reload: nextReload,
    });
    const nextFailure = new Event('vite:preloadError', { cancelable: true });
    nextTarget.dispatchEvent(nextFailure);

    expect(firstReload).toHaveBeenCalledTimes(1);
    expect(nextFailure.defaultPrevented).toBe(true);
    expect(nextReload).toHaveBeenCalledTimes(1);
  });

  it('leaves the original failure visible when the reload guard is unavailable', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    installStaleAssetRecovery(target, {
      storage: {
        getItem: () => {
          throw new Error('storage unavailable');
        },
        setItem: () => undefined,
      },
      entryUrl: '/assets/index-a.js',
      reload,
    });
    const failure = new Event('vite:preloadError', { cancelable: true });

    target.dispatchEvent(failure);

    expect(failure.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
