import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import { createDemoConnector } from '../lib/connector';
import { m } from '../lib/maelstrom';
import { MicToggle } from '../components/mic-toggle';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const connector = useMemo(() => createDemoConnector(), []);

  return (
    <m.Provider connector={connector} debug>
      <DemoApp />
    </m.Provider>
  );
}

function DemoApp() {
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
            <MicToggle />
            <StatusIndicator />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 relative">
        <m.Chart />
      </main>

      {/* Input controls */}
      <div className="bg-gray-800 border-t border-gray-700 p-4">
        <div className="max-w-4xl mx-auto flex flex-col gap-3">
          <IntentInput />
          <VoiceInput />
        </div>
      </div>
    </div>
  );
}

function StatusIndicator() {
  const { connectionStatus, isProcessing } = m.useMaelstrom();

  return (
    <div className="flex items-center gap-2">
      {isProcessing && (
        <span className="text-sm text-blue-400 animate-pulse">
          Processing...
        </span>
      )}
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

  const suggestions = [
    "Expand the weather forecast and show me today's calendar",
    'Start a journal entry about the sprint retro and take notes',
    "Add 'Deploy v2.0' to my tasks and check off 'Setup CI'",
    'Clear the board and just show the weekly weather',
  ];

  return (
    <form onSubmit={handleSubmit}>
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
        {suggestions.map((suggestion) => (
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
  );
}

// Remembers the user's voice preference across visits (app-controlled). NOT the
// browser's audio-unlock — a fresh hard load may still block the first playback
// until a gesture; that's covered by the audioBlocked detection below.
const VOICE_PREF_KEY = 'maelstrom:voice-enabled';

function readVoicePref(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(VOICE_PREF_KEY) === 'true';
}

function VoiceInput() {
  const {
    status,
    currentTranscript,
    micLevel,
    enabled,
    audioBlocked,
    setEnabled,
    startTalking,
    stopTalking,
    enableAudio,
  } = m.voice.useVoice();
  const roomName = useMemo(() => `maelstrom-${nanoid()}`, []);
  const [talking, setTalking] = useState(false);

  const beginTalk = () => {
    setTalking(true);
    void startTalking();
  };
  const endTalk = () => {
    if (!talking) return;
    setTalking(false);
    void stopTalking();
  };

  // First-visit ask, then remember: return visits auto-join + auto-enable; first
  // visit waits for the explicit toggle click (gesture + consent).
  useEffect(() => {
    if (readVoicePref()) {
      void setEnabled(true, roomName);
    }
  }, [setEnabled, roomName]);

  const toggleVoice = () => {
    const next = !enabled;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VOICE_PREF_KEY, String(next));
    }
    void setEnabled(next, roomName);
  };

  const statusColor = !enabled
    ? 'bg-gray-500'
    : status === 'connected'
      ? 'bg-green-500'
      : status === 'connecting'
        ? 'bg-yellow-500'
        : status === 'error'
          ? 'bg-red-500'
          : 'bg-gray-500';

  const statusLabel = !enabled
    ? 'Voice off'
    : status === 'connected'
      ? 'Voice ready'
      : status === 'connecting'
        ? 'Connecting...'
        : status === 'error'
          ? 'Voice error'
          : 'Voice disconnected';

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={toggleVoice}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors select-none ${
          enabled
            ? 'bg-blue-600 hover:bg-blue-700'
            : 'bg-gray-700 hover:bg-gray-600'
        }`}
        aria-pressed={enabled}
        aria-label={enabled ? 'Turn voice off' : 'Turn voice on'}
      >
        <span>{enabled ? '🔊' : '🔇'}</span>
        <span>{enabled ? 'Voice on' : 'Voice off'}</span>
      </button>

      <div className="flex items-center gap-2 text-sm text-gray-400">
        <div className={`w-2 h-2 rounded-full ${statusColor}`} />
        <span>{statusLabel}</span>
      </div>

      <button
        type="button"
        disabled={!enabled || status !== 'connected'}
        onMouseDown={beginTalk}
        onMouseUp={endTalk}
        onMouseLeave={endTalk}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors select-none disabled:bg-gray-800 disabled:cursor-not-allowed ${
          talking
            ? 'bg-red-600 ring-2 ring-red-400 animate-pulse'
            : 'bg-gray-700 hover:bg-gray-600'
        }`}
        aria-label="Hold to speak"
        aria-pressed={talking}
      >
        <span>🎤</span>
        <span>{talking ? 'Listening…' : 'Hold to speak'}</span>
      </button>

      {/* Live mic level — proves the browser is capturing while you hold. */}
      {talking && (
        <div className="flex items-center gap-1" aria-label="Mic input level">
          <div className="h-3 w-32 rounded bg-gray-700 overflow-hidden">
            <div
              className="h-full bg-green-500 transition-[width] duration-75"
              style={{ width: `${Math.min(100, Math.round(micLevel * 300))}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-gray-400">
            {Math.round(micLevel * 100)}
          </span>
        </div>
      )}

      {/* Conditional "tap to enable sound" — only when playback is actually blocked */}
      {enabled && audioBlocked && (
        <button
          type="button"
          onClick={() => void enableAudio()}
          className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors select-none"
        >
          <span>🔈</span>
          <span>Tap to enable sound</span>
        </button>
      )}

      {currentTranscript && (
        <span className="text-sm text-gray-400 italic truncate max-w-xs">
          "{currentTranscript}"
        </span>
      )}
    </div>
  );
}
