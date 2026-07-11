import { useState } from 'react';

export interface KeyDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: (apiKey: string, remember: boolean) => void;
  readonly errorMessage?: string | null;
}

/**
 * BYOK key entry drawer, shown before the first Send/mic press in hosted
 * mode when no visitor key is on hand. Custody copy and the "remember"
 * opt-in are load-bearing — the key only touches localStorage if the
 * visitor explicitly asks for it (`setPlaygroundKey`'s `remember` flag).
 */
export function KeyDrawer({
  isOpen,
  onClose,
  onSave,
  errorMessage,
}: KeyDrawerProps) {
  const [apiKey, setApiKey] = useState('');
  const [remember, setRemember] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!apiKey.trim()) return;
    onSave(apiKey.trim(), remember);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="surface w-full max-w-md p-6">
        <p className="eyebrow">BYOK Playground</p>
        <h2 className="mt-1 text-lg font-semibold text-ink">
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
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
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
          Your key goes to OpenAI — we never store it.
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
            className="text-sm text-ink-3 underline"
          >
            run it locally instead
          </a>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
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
