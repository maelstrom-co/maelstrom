const RELOAD_MARKER = 'maelstrom:stale-asset-reload';

interface StaleAssetRecoveryOptions {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly entryUrl: string;
  readonly reload: () => void;
}

export function installStaleAssetRecovery(
  target: EventTarget,
  options: StaleAssetRecoveryOptions,
): void {
  target.addEventListener('vite:preloadError', (event) => {
    try {
      if (options.storage.getItem(RELOAD_MARKER) === options.entryUrl) return;
      options.storage.setItem(RELOAD_MARKER, options.entryUrl);
    } catch {
      return;
    }

    event.preventDefault();
    options.reload();
  });
}
