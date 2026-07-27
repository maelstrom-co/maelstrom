import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Captions } from '../components/captions';
import { FIRST_RUN_EXAMPLES, FirstRunHint } from '../components/first-run-hint';
import { VoiceControl } from '../components/voice-control';
import { VoiceErrorNote } from '../components/voice-error-note';
import { createDemoConnector } from '../lib/connector';
import { isDebugRequested } from '../lib/debug-mode';
import { STATUS_COLORS } from '../lib/design-tokens';
import { m } from '../lib/maelstrom';
import { useFlashInstances } from '../lib/use-touched-instances';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const connector = useMemo(() => createDemoConnector(), []);
  const debug = useMemo(() => isDebugRequested(), []);

  return (
    <m.Provider connector={connector} debug={debug}>
      <DemoApp />
    </m.Provider>
  );
}

function DemoApp() {
  const { isProcessing } = m.useMaelstrom();
  const { state: voiceState } = m.useVoice();
  const thinking = isProcessing || voiceState === 'thinking';

  return (
    <div className="h-screen flex flex-col relative z-[2]">
      {/* Header */}
      <header
        className="border-b px-6 py-4 bg-bg-1"
        style={{ borderColor: 'var(--line)' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="eyebrow">Maelstrom Demo</h1>
            <p className="text-sm text-ink-2 mt-1">
              AI-Orchestrated Dynamic UI
            </p>
          </div>
          <div className="flex items-center gap-3">
            <VoiceControl showOrb={false} />
            <StatusIndicator />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 relative">
        <div
          className="chart-wrapper"
          data-thinking={thinking ? 'true' : undefined}
        >
          <m.Chart />
        </div>
        <FirstRunHint />
        <ActionFlash />
        <Captions />
      </main>

      {/* Intent input */}
      <IntentInput />
    </div>
  );
}

/**
 * Renders nothing — subscribes to the last-settled instance diff and flags
 * the corresponding `[data-instance-id]` DOM wrappers with `data-flash`
 * directly (Chart owns that DOM, not this component's React tree).
 */
function ActionFlash() {
  const touched = m.useTouchedInstances();
  useFlashInstances(touched);
  return null;
}

function StatusIndicator() {
  const { connectionStatus } = m.useMaelstrom();
  const color = STATUS_COLORS[connectionStatus];

  return (
    <div
      className="status-pill flex items-center gap-2 rounded-full px-3 py-1 font-mono text-xs uppercase tracking-[.1em] text-ink-2"
      role="status"
      aria-label={`Connection status: ${connectionStatus}`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      {connectionStatus}
    </div>
  );
}

function IntentInput() {
  const [intent, setIntent] = useState('');
  const { processIntent, isProcessing, lastError } = m.useMaelstrom();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim() || isProcessing) return;

    await processIntent(intent);
    setIntent('');
  };

  return (
    <div
      className="border-t p-4 bg-bg-1"
      style={{ borderColor: 'var(--line)' }}
    >
      <VoiceErrorNote />
      <div className="flex justify-center mb-3">
        <m.VoiceOrb size={56} className="voice-orb" />
      </div>
      <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
        <div className="flex gap-2">
          <input
            type="text"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="Tell Maelstrom what you want to do..."
            className="intent-pill flex-1 px-4 py-3"
            disabled={isProcessing}
          />
          <button
            type="submit"
            disabled={isProcessing || !intent.trim()}
            className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Processing...' : 'Send'}
          </button>
        </div>

        {lastError && (
          <div className="mt-2 text-sm text-pink">
            Error: {lastError.message}
          </div>
        )}

        {/* Suggestions */}
        <div className="mt-3 flex flex-wrap gap-2">
          {FIRST_RUN_EXAMPLES.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setIntent(suggestion)}
              className="btn btn-ghost text-xs px-3 py-1.5"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
