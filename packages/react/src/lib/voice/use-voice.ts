import type { VoiceConnector } from '@maelstrom-co/client';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import type { MaelstromContextPair } from '../context.js';
import { warnOnce } from '../warn-once.js';
import type {
  UseVoiceOptions,
  UseVoiceReturn,
  VoiceSessionState,
} from './use-voice-types.js';

/**
 * Factory that creates the m.useVoice() hook bound to a specific Maelstrom context.
 */
export function createUseVoice(contextPair: MaelstromContextPair) {
  const { useMaelstromContext } = contextPair;

  const store = createVoiceSessionStore();
  let ownerOptionsRef: { current: UseVoiceOptions | undefined } | null = null;

  function handleVoiceError(err: unknown) {
    if (ownerOptionsRef?.current?.onError) {
      ownerOptionsRef.current.onError(err);
    } else {
      console.error('[Maelstrom] Voice session error:', err);
    }
  }

  const actions = {
    start: () => {
      const session = store.getSession();
      if (!session) {
        warnOnce(
          'voice-no-session',
          '[Maelstrom] voice.start() called but no session exists. Call useVoice() with options in a parent component to create a session.',
        );
        return;
      }
      (session.isAudioReady ? Promise.resolve() : session.prepareAudio())
        .then(() => session.startListening())
        .catch(handleVoiceError);
    },
    stop: () => {
      store.getSession()?.stopListening();
    },
    interrupt: () => {
      store.getSession()?.interrupt();
    },
    prepareAudio: () => {
      store.getSession()?.prepareAudio().catch(handleVoiceError);
    },
  };

  return function useVoice(options?: UseVoiceOptions): UseVoiceReturn {
    const { connector, config } = useMaelstromContext();

    const voiceSupported = connector.capabilities.voice;

    const hookOptionsRef = useRef(options);
    hookOptionsRef.current = options;

    const hasOptions = !!options && Object.keys(options).length > 0;

    const snapshot = useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot,
    );

    useEffect(() => {
      if (!hasOptions) return;
      if (!voiceSupported) return;

      if (store.getOwnerId()) {
        warnOnce(
          'voice-multiple-owners',
          '[Maelstrom] Another component already owns the voice session. Only one useVoice() caller should pass options at a time.',
        );
        return;
      }

      const myId = Symbol('voice-owner');
      store.setOwnerId(myId);
      ownerOptionsRef = hookOptionsRef;

      let cancelled = false;

      import('@maelstrom-co/voice')
        .catch(() => {
          if (!cancelled) {
            warnOnce(
              'voice-missing',
              '[Maelstrom] @maelstrom-co/voice is not installed. Voice features are disabled. Install it as a peer dependency to enable voice.',
            );
            store.setIsVoiceSupported(false);
          }
          return null;
        })
        .then((voiceModule) => {
          if (!voiceModule || cancelled || store.getOwnerId() !== myId) return;

          const { VoiceSession } = voiceModule;
          if (!VoiceSession) return;

          // hasOptions guard above guarantees `current` is defined here.
          const opts = hookOptionsRef.current!;
          const baseConfig = {
            connector: connector as VoiceConnector,
            sessionId: 'default',
            ...(opts.language && { language: opts.language }),
            useVadToFinalizeInterims: opts.useVadToFinalizeInterims ?? true,
            allowBargeIn: opts.allowBargeIn ?? true,
            vadOptions: {
              activationThreshold: 0.5,
              ...opts.vadOptions,
            },
            debugMode: config.debug,
          };
          const session = new VoiceSession(
            opts.autoAcquireMic
              ? {
                  ...baseConfig,
                  autoAcquireMic: true,
                  ...(opts.greeting && { greeting: opts.greeting }),
                }
              : { ...baseConfig, autoAcquireMic: false },
          );

          const unsubs = [
            session.on('transcript', (text: string, isFinal: boolean) => {
              ownerOptionsRef?.current?.onTranscript?.(text, isFinal);
            }),
            session.on('stateChange', (s: VoiceSessionState) => {
              store.setState(s);
              ownerOptionsRef?.current?.onStateChange?.(s);
            }),
            session.on(
              'response',
              (r: { userMessage?: string; requestId: string }) => {
                ownerOptionsRef?.current?.onResponse?.(r);
              },
            ),
            session.on('speechStarted', (t: string) => {
              ownerOptionsRef?.current?.onSpeechStarted?.(t);
            }),
            session.on('error', handleVoiceError),
            session.on('audioLevel', (level: number) => {
              ownerOptionsRef?.current?.onAudioLevel?.(level);
            }),
          ];

          store.claimSession(session, unsubs);
        });

      return () => {
        cancelled = true;
        if (store.getOwnerId() === myId) {
          ownerOptionsRef = null;
          store.unsubscribeAll();
          store.getSession()?.destroy();
          store.reset();
        }
      };
    }, [hasOptions, connector, voiceSupported, config.debug]);

    return {
      state: snapshot.state,
      isReady: snapshot.isReady,
      isVoiceSupported:
        snapshot.isVoiceSupported !== undefined
          ? snapshot.isVoiceSupported
          : voiceSupported,
      ...actions,
    };
  };
}

interface VoiceSnapshot {
  state: VoiceSessionState;
  isReady: boolean;
  isVoiceSupported: boolean | undefined;
}

interface VoiceSessionLike {
  isAudioReady: boolean;
  prepareAudio(): Promise<void>;
  startListening(): Promise<void>;
  stopListening(): void;
  interrupt(): void;
  destroy(): void;
  on(event: string, cb: (...args: unknown[]) => void): () => void;
}

interface VoiceSessionStore {
  subscribe: (callback: () => void) => () => void;
  getSnapshot: () => VoiceSnapshot;
  getSession: () => VoiceSessionLike | null;
  getOwnerId: () => symbol | null;
  setOwnerId: (id: symbol) => void;
  claimSession: (session: VoiceSessionLike, unsubs: (() => void)[]) => void;
  unsubscribeAll: () => void;
  setState: (state: VoiceSessionState) => void;
  setIsVoiceSupported: (supported: boolean) => void;
  reset: () => void;
}

function createVoiceSessionStore(): VoiceSessionStore {
  let session: VoiceSessionLike | null = null;
  let ownerId: symbol | null = null;
  let eventUnsubs: (() => void)[] = [];
  let state: VoiceSessionState = 'idle';
  let isReady = false;
  let isVoiceSupported: boolean | undefined;
  const listeners = new Set<() => void>();

  let cachedSnapshot: VoiceSnapshot = {
    state: 'idle',
    isReady: false,
    isVoiceSupported: undefined,
  };

  function getSnapshot(): VoiceSnapshot {
    if (
      cachedSnapshot.state !== state ||
      cachedSnapshot.isReady !== isReady ||
      cachedSnapshot.isVoiceSupported !== isVoiceSupported
    ) {
      cachedSnapshot = { state, isReady, isVoiceSupported };
    }
    return cachedSnapshot;
  }

  function notifyListeners() {
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    subscribe(callback: () => void) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    getSnapshot,
    getSession: () => session,
    getOwnerId: () => ownerId,
    setOwnerId: (id) => {
      ownerId = id;
    },
    claimSession: (s, unsubs) => {
      session = s;
      eventUnsubs = unsubs;
      isReady = true;
      notifyListeners();
    },
    unsubscribeAll: () => {
      eventUnsubs.forEach((fn) => {
        fn();
      });
      eventUnsubs = [];
    },
    setState: (s) => {
      state = s;
      notifyListeners();
    },
    setIsVoiceSupported: (supported) => {
      isVoiceSupported = supported;
      notifyListeners();
    },
    reset: () => {
      session = null;
      ownerId = null;
      state = 'idle';
      isReady = false;
      isVoiceSupported = undefined;
      notifyListeners();
    },
  };
}
