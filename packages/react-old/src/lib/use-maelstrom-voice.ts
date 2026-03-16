import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  VADStreamOptions,
  VoiceConnector,
  VoiceSessionState,
} from '@maelstrom-co/voice-old';
import { VoiceSession } from '@maelstrom-co/voice-old';
import { VoiceError } from '@maelstrom-co/protocol-old';

import { useMaelstromContext } from './context.js';

export interface UseMaelstromVoiceOptions {
  language?: string;
  greeting?: string;
  vadOptions?: VADStreamOptions;
  useVadToFinalizeInterims?: boolean;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAudioOutput?: (audioData: Uint8Array) => void;
  onVoiceStateChange?: (state: VoiceSessionState) => void;
  onResponse?: (response: { userMessage?: string; requestId: string }) => void;
  onSpeechStarted?: (text: string) => void;
}

export interface UseMaelstromVoiceReturn {
  state: VoiceSessionState;
  isListening: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  transcript: string;
  audioLevel: number;
  isAudioReady: boolean;
  prepareAudio: () => Promise<void>;
  startListening: () => Promise<void>;
  stopListening: () => void;
  interrupt: () => void;
  isVoiceSupported: boolean;
  error: VoiceError | null;
}

export function useMaelstromVoice(
  options: UseMaelstromVoiceOptions = {},
): UseMaelstromVoiceReturn {
  const {
    orchestrator,
    connector: baseConnector,
    debug,
  } = useMaelstromContext();

  const connector: VoiceConnector | undefined = baseConnector?.capabilities
    .voice
    ? (baseConnector as VoiceConnector)
    : undefined;

  const isVoiceSupported = Boolean(connector);

  const [state, setState] = useState<VoiceSessionState>('idle');
  const [transcript, setTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [error, setError] = useState<VoiceError | null>(null);

  const sessionRef = useRef<VoiceSession | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!connector) return;

    const session = new VoiceSession({
      connector,
      sessionId: orchestrator.getConfig().sessionId ?? 'default',
      ...(optionsRef.current.greeting && {
        greeting: optionsRef.current.greeting,
      }),
      useVadToFinalizeInterims:
        optionsRef.current.useVadToFinalizeInterims ?? true,
      vadOptions: {
        activationThreshold: 0.5,
        ...optionsRef.current.vadOptions,
      },
      debugMode: debug,
      onTranscript: (text, isFinal) => {
        setTranscript(isFinal ? '' : text);
        optionsRef.current.onTranscript?.(text, isFinal);
      },
      onAudioOutput: (data) => optionsRef.current.onAudioOutput?.(data),
      onVoiceStateChange: (s) => {
        setState(s);
        setIsAudioReady(session.isAudioReady);
        optionsRef.current.onVoiceStateChange?.(s);
      },
      onResponse: (r) => optionsRef.current.onResponse?.(r),
      onSpeechStarted: (t) => optionsRef.current.onSpeechStarted?.(t),
      onError: setError,
    });

    session.on('audioLevel', setAudioLevel);
    sessionRef.current = session;

    return () => {
      session.destroy();
      sessionRef.current = null;
    };
  }, [connector, orchestrator, debug]);

  const prepareAudio = useCallback(async () => {
    await sessionRef.current?.prepareAudio();
    setIsAudioReady(sessionRef.current?.isAudioReady ?? false);
  }, []);

  const startListening = useCallback(async () => {
    if (!sessionRef.current) {
      setError(new VoiceError('UNKNOWN', 'Voice not supported'));
      return;
    }
    await sessionRef.current.startListening();
  }, []);

  const stopListening = useCallback(() => {
    sessionRef.current?.stopListening();
  }, []);

  const interrupt = useCallback(() => {
    sessionRef.current?.interrupt();
  }, []);

  return {
    state,
    isListening: state === 'listening',
    isProcessing: state === 'silence',
    isSpeaking: state === 'speaking',
    transcript,
    audioLevel,
    isAudioReady,
    prepareAudio,
    startListening,
    stopListening,
    interrupt,
    isVoiceSupported,
    error,
  };
}
