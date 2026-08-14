import { useStore } from '@tanstack/react-store';
import { useEffect, useRef, useState } from 'react';
import { playgroundKeyStore } from '../lib/playground-key-store';

export interface KeyDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: (apiKey: string) => void;
  readonly onRemove?: () => void;
  readonly errorMessage?: string | null;
}

// Real OpenAI keys run 40+ characters, so this floor can never reject a
// genuine key. It exists to catch the case a too-short string still reaches
// the server: the hello-gate redaction there matches by exact substring, so
// a 1-3 char "key" rewrites unrelated wire content (e.g. "executionPlan")
// and the client can no longer decode any reply.
const MIN_API_KEY_LENGTH = 20;

/**
 * BYOK key entry drawer, shown before the first Send/mic press in hosted
 * mode when no visitor key is on hand, or on demand via the header "API
 * key" affordance. The key stays in browser memory for this page session and
 * is never rendered back into the input after use.
 */
export function KeyDrawer({
  isOpen,
  onClose,
  onSave,
  onRemove,
  errorMessage,
}: KeyDrawerProps) {
  const [apiKey, setApiKey] = useState('');
  const storedKey = useStore(playgroundKeyStore, (state) => state.apiKey);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmedApiKey = apiKey.trim();
  const isTooShort =
    trimmedApiKey.length > 0 && trimmedApiKey.length < MIN_API_KEY_LENGTH;

  const handleSave = () => {
    if (trimmedApiKey.length < MIN_API_KEY_LENGTH) return;
    onSave(trimmedApiKey);
    setApiKey('');
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
          placeholder={storedKey ? 'set for this session' : 'sk-...'}
          autoComplete="off"
          aria-describedby={isTooShort ? 'playground-api-key-hint' : undefined}
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-ink"
          style={{
            borderColor: 'var(--line-2)',
            background: 'rgba(255, 255, 255, 0.03)',
          }}
        />
        {isTooShort && (
          <p id="playground-api-key-hint" className="mt-1 text-xs text-pink">
            API keys are at least {MIN_API_KEY_LENGTH} characters — check you
            pasted the whole thing.
          </p>
        )}

        <p className="mt-3 text-sm text-ink-3">
          Your key stays in browser memory and disappears when you reload or
          close this page. Voice connects to OpenAI directly. Text requests go
          through our server, which holds the key in memory only — never written
          to disk or logs.
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
              disabled={trimmedApiKey.length < MIN_API_KEY_LENGTH}
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
