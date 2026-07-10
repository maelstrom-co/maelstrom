import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Captions } from '../components/captions';
import { FIRST_RUN_EXAMPLES, FirstRunHint } from '../components/first-run-hint';
import { VoiceErrorNote } from '../components/voice-error-note';
import { createDemoConnector } from '../lib/connector';
import { m } from '../lib/maelstrom';
import { VoiceControl } from '../components/voice-control';
import { useFlashInstances } from '../lib/use-touched-instances';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const connector = useMemo(() => createDemoConnector(), []);

  return (
    <m.Provider connector={connector} debug={import.meta.env.DEV}>
      <DemoApp />
    </m.Provider>
  );
}

function DemoApp() {
  const { isProcessing } = m.useMaelstrom();
  const { state: voiceState } = m.useVoice();
  const thinking = isProcessing || voiceState === 'thinking';

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Maelstrom Demo</h1>
            <p className="text-sm text-gray-400">AI-Orchestrated Dynamic UI</p>
          </div>
          <div className="flex items-center gap-3">
            <VoiceControl />
            <StatusIndicator />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 relative">
        <div className="chart-wrapper" data-thinking={thinking ? 'true' : undefined}>
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

  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-2 h-2 rounded-full ${
          connectionStatus === 'connected'
            ? 'bg-green-500'
            : connectionStatus === 'connecting'
              ? 'bg-yellow-500'
              : connectionStatus === 'error'
                ? 'bg-red-500'
                : 'bg-gray-500'
        }`}
      />
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
    <div className="bg-gray-800 border-t border-gray-700 p-4">
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
            className="intent-input flex-1"
            disabled={isProcessing}
          />
          <button
            type="submit"
            disabled={isProcessing || !intent.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-medium transition-colors"
          >
            {isProcessing ? 'Processing...' : 'Send'}
          </button>
        </div>

        {lastError && (
          <div className="mt-2 text-sm text-red-400">
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
              className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded-full text-gray-300 transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
