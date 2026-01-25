import type { MaelstromResponse } from '@maelstrom/protocol';
import {
  Chart,
  MaelstromProvider,
  useCreateInstance,
  useMaelstrom,
  useVesselRegistration,
} from '@maelstrom/react';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createServerFnConnector } from '../lib/connector';
import { useServerAudio } from '../lib/use-server-audio';
import { calendarRegistration } from '../vessels/calendar.vessel';
import { weatherRegistration } from '../vessels/weather.vessel';

export const Route = createFileRoute('/')({
  component: HomePage,
});

// Create connector once
const connector = createServerFnConnector();

function HomePage() {
  // Reference to speak function from audio hook (will be set by DemoApp)
  const speakRef = useRef<((text: string) => Promise<void>) | null>(null);

  const handleResponse = useCallback((response: MaelstromResponse) => {
    // Speak the userMessage if available
    if (response.userMessage && speakRef.current) {
      speakRef.current(response.userMessage);
    }
  }, []);

  return (
    <MaelstromProvider
      connector={connector}
      sessionId="demo-session"
      onResponse={handleResponse}
      debug
    >
      <DemoApp speakRef={speakRef} />
    </MaelstromProvider>
  );
}

interface DemoAppProps {
  speakRef: React.RefObject<((text: string) => Promise<void>) | null>;
}

function DemoApp({ speakRef }: DemoAppProps) {
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
      <IntentInput speakRef={speakRef} />
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

interface IntentInputProps {
  speakRef: React.MutableRefObject<((text: string) => Promise<void>) | null>;
}

function IntentInput({ speakRef }: IntentInputProps) {
  const [intent, setIntent] = useState('');
  const { processIntent, isProcessing, lastError } = useMaelstrom();

  const {
    isRecording,
    isTranscribing,
    isSpeaking,
    transcript,
    toggleRecording,
    speak,
    error: audioError,
  } = useServerAudio({
    autoProcessIntent: true,
    processIntent,
  });

  // Set the speak function ref so the parent can use it in onResponse
  useEffect(() => {
    speakRef.current = speak;
  }, [speak, speakRef]);

  const isVoiceBusy = isRecording || isTranscribing;

  // Update intent field with voice transcript
  useEffect(() => {
    if (transcript && !isRecording) {
      setIntent(transcript);
    }
  }, [transcript, isRecording]);

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

  const getPlaceholder = () => {
    if (isRecording) return 'Recording...';
    if (isTranscribing) return 'Transcribing...';
    return 'Tell Maelstrom what you want to do...';
  };

  const getMicButtonClass = () => {
    if (isRecording) return 'bg-red-600 hover:bg-red-700 animate-pulse';
    if (isTranscribing) return 'bg-yellow-600 animate-pulse';
    return 'bg-gray-700 hover:bg-gray-600';
  };

  return (
    <div className="bg-gray-800 border-t border-gray-700 p-4">
      <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
        <div className="flex gap-2">
          {/* Voice input button */}
          <button
            type="button"
            onClick={toggleRecording}
            disabled={isProcessing || isTranscribing}
            className={`px-4 py-3 rounded-lg font-medium transition-colors ${getMicButtonClass()} disabled:bg-gray-600 disabled:cursor-not-allowed`}
            title={isRecording ? 'Stop recording' : 'Start voice input'}
          >
            {isRecording ? <MicrophoneOnIcon /> : <MicrophoneOffIcon />}
          </button>

          <input
            type="text"
            value={isRecording ? '' : intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder={getPlaceholder()}
            className="intent-input flex-1"
            disabled={isProcessing || isVoiceBusy}
          />
          <button
            type="submit"
            disabled={isProcessing || !intent.trim() || isVoiceBusy}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-medium transition-colors"
          >
            {isProcessing ? 'Processing...' : 'Send'}
          </button>
        </div>

        {/* Status indicators */}
        {isSpeaking && (
          <div className="mt-2 text-sm text-blue-400 animate-pulse">
            Speaking...
          </div>
        )}

        {(lastError || audioError) && (
          <div className="mt-2 text-sm text-red-400">
            Error: {lastError || audioError?.message}
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
              disabled={isVoiceBusy}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}

function MicrophoneOnIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function MicrophoneOffIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
        clipRule="evenodd"
      />
    </svg>
  );
}
