import { useEffect, useRef, useState } from 'react';
import { useStore } from '@tanstack/react-store';
import { playgroundKeyStore } from '../lib/playground-key-store';

export interface KeyDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: (apiKey: string, remember: boolean) => void;
  readonly onRemove?: () => void;
  readonly errorMessage?: string | null;
}

/**
 * BYOK key entry drawer, shown before the first Send/mic press in hosted
 * mode when no visitor key is on hand, or on demand via the header "API
 * key" affordance. Custody copy and the "remember" opt-in are load-bearing
 * — the key only touches localStorage if the visitor explicitly asks for
 * it (`setPlaygroundKey`'s `remember` flag), and a stored key is never
 * rendered back into the input.
 */
export function KeyDrawer({
  isOpen,
  onClose,
  onSave,
  onRemove,
  errorMessage,
}: KeyDrawerProps) {
  const [apiKey, setApiKey] = useState('');
  const [remember, setRemember] = useState(false);
  const storedKey = useStore(playgroundKeyStore, (state) => state.apiKey);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (!apiKey.trim()) return;
    onSave(apiKey.trim(), remember);
    setApiKey('');
    setRemember(false);
  };

  const handleClose = () => {
    setApiKey('');
    onClose();
  };

  const handleRemove = () => {
    setApiKey('');
    onRemove?.();
  };

  // Both effects are gated on isOpen rather than mounted/unmounted below it —
  // the drawer stays mounted across open/close (see the save/reopen and
  // Cancel/reopen tests), so hooks must run unconditionally on every render.
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // Deps deliberately narrowed to [isOpen]: handleClose is recreated every
    // render but is stable in intent (always clears apiKey + calls onClose),
    // so tracking it would just thrash the listener on unrelated re-renders.
    // (No biome-ignore here — Biome's React domain detection doesn't fire on
    // this app's "react": "catalog:" dependency, so useExhaustiveDependencies
    // never flags this effect, and a suppression for a rule that isn't
    // firing is itself flagged as an unused suppression under
    // --error-on-warnings.)
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="key-drawer-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="surface w-full max-w-md p-6">
        <p className="eyebrow">BYOK Playground</p>
        <h2
          id="key-drawer-heading"
          className="mt-1 text-lg font-semibold text-ink"
        >
          Add your OpenAI key
        </h2>

        <label
          className="mt-4 block text-sm text-ink-2"
          htmlFor="playground-api-key"
        >
          API key
        </label>
        <input
          id="playground-api-key"
          ref={inputRef}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={storedKey ? 'saved on this device' : 'sk-...'}
          autoComplete="off"
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-ink"
          style={{
            borderColor: 'var(--line-2)',
            background: 'rgba(255, 255, 255, 0.03)',
          }}
        />

        <label
          className="mt-3 flex items-center gap-2 text-sm text-ink-2"
          htmlFor="remember-key"
        >
          <input
            id="remember-key"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember on this device
        </label>

        <p className="mt-3 text-sm text-ink-3">
          Your key goes straight to OpenAI — it never reaches our servers.
        </p>

        {errorMessage && (
          <p
            role="alert"
            className="mt-2 rounded-md border border-pink/30 bg-pink/10 px-3 py-1.5 text-xs text-pink"
          >
            {errorMessage}
          </p>
        )}

        <div className="mt-5 flex items-center justify-between">
          <a
            href="https://github.com/maelstrom-co/maelstrom/blob/main/README.md"
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm text-ink-3 underline"
          >
            run it locally instead
          </a>
          <div className="flex gap-2">
            {storedKey && (
              <button
                type="button"
                onClick={handleRemove}
                className="btn btn-ghost px-4 py-2 text-sm text-pink"
              >
                Remove key
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="btn btn-ghost px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!apiKey.trim()}
              className="btn btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
