import {
  MaelstromProvider,
  TilingChart,
  useMaelstrom,
  useMaelstromVoice,
  useVesselRegistration,
  VoiceOrb,
} from '@maelstrom-co/react-old';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { createDemoConnector } from '../lib/connector';
import { calendarRegistration } from '../vessels/calendar.vessel';
import { journalRegistration } from '../vessels/journal.vessel';
import { tasksRegistration } from '../vessels/tasks.vessel';
import { weatherRegistration } from '../vessels/weather.vessel';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const connector = useMemo(() => createDemoConnector(), []);

  return (
    <MaelstromProvider connector={connector} debug>
      <VesselRegistrations />
      <DemoApp />
    </MaelstromProvider>
  );
}

function VesselRegistrations() {
  useVesselRegistration(calendarRegistration);
  useVesselRegistration(weatherRegistration);
  useVesselRegistration(journalRegistration);
  useVesselRegistration(tasksRegistration);
  return null;
}

function DemoApp() {
  const { processIntent, isProcessing } = useMaelstrom();

  const voice = useMaelstromVoice({
    greeting:
      "Hello! I'm the Maelstrom demo assistant. I can help you manage your calendar, weather, journal, and tasks. Try asking me to rearrange your dashboard or perform actions like adding tasks or writing journal entries.",
    onTranscript: (text, isFinal) => {
      if (!isFinal || !text.trim() || isProcessing) return;
      processIntent(text);
    },
  });

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
            <VoiceOrb
              state={
                voice.isListening
                  ? 'listening'
                  : voice.isSpeaking
                    ? 'speaking'
                    : voice.isProcessing
                      ? 'processing'
                      : 'idle'
              }
              audioLevel={voice.audioLevel}
              size={40}
              onClick={() => {
                if (voice.isListening) {
                  voice.stopListening();
                } else {
                  voice.startListening();
                }
              }}
            />
            <StatusIndicator />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 relative">
        <TilingChart />
      </main>

      {/* Intent input */}
      <IntentInput />
    </div>
  );
}

function StatusIndicator() {
  const { connectionStatus, isProcessing } = useMaelstrom();

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
  const { processIntent, isProcessing, lastError } = useMaelstrom();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim() || isProcessing) return;

    await processIntent(intent);
    setIntent('');
  };

  const suggestions = [
    'Expand the weather forecast and show me today\'s calendar',
    'Start a journal entry about the sprint retro and take notes',
    'Add \'Deploy v2.0\' to my tasks and check off \'Setup CI\'',
    'Clear the board and just show the weekly weather',
  ];

  return (
    <div className="bg-gray-800 border-t border-gray-700 p-4">
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
    </div>
  );
}
