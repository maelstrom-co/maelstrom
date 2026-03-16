import {
  Chart,
  MaelstromProvider,
  useCreateInstance,
  useMaelstrom,
  useVesselRegistration,
} from '@maelstrom-co/react';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { createServerFnConnector } from '../lib/connector';
import { calendarRegistration } from '../vessels/calendar.vessel';
import { weatherRegistration } from '../vessels/weather.vessel';

export const Route = createFileRoute('/')({
  component: HomePage,
});

// Create connector once
const connector = createServerFnConnector();

function HomePage() {
  return (
    <MaelstromProvider
      connector={connector}
      sessionId="demo-session"
      debug
    >
      <DemoApp />
    </MaelstromProvider>
  );
}

function DemoApp() {
  // Register vessels
  useVesselRegistration(calendarRegistration);
  useVesselRegistration(weatherRegistration);

  const createInstance = useCreateInstance();
  const { instances } = useMaelstrom();

  // Create initial instances on mount
  // Sizes come from variant minSize, positions are grid coordinates
  useEffect(() => {
    if (instances.length === 0) {
      createInstance('calendar', {
        instanceId: 'calendar-1',
        position: (chart) => ({
          row: Math.floor((chart.rows - 4) / 2),
          column: Math.floor((chart.columns - 8) / 2),
        }),
      });
      createInstance('weather', {
        instanceId: 'weather-1',
        position: (chart) => ({
          row: Math.floor((chart.rows - 4) / 2),
          column: Math.floor((chart.columns - 8) / 2) + 5,
        }),
      });
    }
  }, [createInstance, instances.length]);

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Maelstrom Demo</h1>
            <p className="text-sm text-gray-400">AI-Orchestrated Dynamic UI</p>
          </div>
          <StatusIndicator />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 relative">
        <Chart showGrid />
      </main>

      {/* Intent input */}
      <IntentInput />
    </div>
  );
}

function StatusIndicator() {
  const { connectionState, isProcessing } = useMaelstrom();

  return (
    <div className="flex items-center gap-2">
      {isProcessing && (
        <span className="text-sm text-blue-400 animate-pulse">
          Processing...
        </span>
      )}
      <div
        className={`w-2 h-2 rounded-full ${
          connectionState === 'connected'
            ? 'bg-green-500'
            : connectionState === 'connecting'
              ? 'bg-yellow-500'
              : connectionState === 'error'
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
    'Show me the weekly calendar view',
    'Minimize the calendar and show the weather forecast',
    'Expand the weather to show hourly forecast',
    'Switch the calendar back to month view',
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
            Error: {lastError}
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
