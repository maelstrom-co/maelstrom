import { useEffect, useRef, useSyncExternalStore } from 'react';
import { SessionId } from '@maelstrom-co/protocol';
import type { MaelstromExtensionContext } from '@maelstrom-co/react';
import { warnOnce } from '@maelstrom-co/react';
import type { VoiceSession, VoiceSessionConfig } from '@maelstrom-co/voice';

import {
  VOICE_PEER_LOAD_FAILED_MSG,
  VOICE_PEER_NOT_INSTALLED_MSG,
  VOICE_SESSION_EXPORT_MISSING_MSG,
  VoiceDependencyError,
} from './errors.js';
import type {
  UseVoiceOptions,
  UseVoiceReturn,
  VoiceSessionState,
} from './use-voice-types.js';
import { isMissingModuleError, type VoiceProbeResult } from './voice-probe.js';

/**
 * Requires a pre-resolved `voiceModulePromise` (no internal fallback
 * `import()`) so the probe runs in exactly one place — keeping the SSR
 * guard and cause-preservation invariants from being bypassed by callers
 * that skip the public factory.
 */
export function createUseVoice(
  contextPair: MaelstromExtensionContext,
  voiceModulePromise: Promise<VoiceProbeResult>,
) {
  const { useMaelstromContext } = contextPair;

  const store = createVoiceSessionStore();
  let ownerOptionsRef: { current: UseVoiceOptions | undefined } | null = null;

  function handleVoiceError(err: unknown) {
    const onError = ownerOptionsRef?.current?.onError;
    if (onError) {
      try {
        onError(err);
      } catch (callbackErr) {
        // `react-error-boundary`'s `showBoundary` throws by design; without
        // this try/catch the throw escapes as an unhandled rejection and
        // the surrounding state flip is bypassed.
        console.error('[Maelstrom] onError callback threw:', callbackErr);
        console.error('[Maelstrom] Original voice error:', err);
      }
    } else {
      console.error('[Maelstrom] Voice session error:', err);
    }
  }

  const actions = {
    start: (): Promise<void> => {
      const session = store.getSession();
      if (!session) {
        warnOnce(
          'voice-no-session',
          '[Maelstrom] voice.start() called but no session exists. Call useVoice() with options in a parent component to create a session.',
        );
        return Promise.resolve();
      }
      // Surface errors via onError without forcing call sites to chain
      // .catch — the type contract still resolves (returned promise never
      // rejects) so callers that *do* want UI feedback can attach .then()
      // and read voice state, while bare-call sites stay one-liner safe.
      return (
        session.isAudioReady ? Promise.resolve() : session.prepareAudio()
      )
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

      voiceModulePromise.then((result) => {
        if (cancelled || store.getOwnerId() !== myId) return;

        if (result.status === 'skipped') {
          // useEffect only runs client-side, so reaching `skipped` here means
          // the probe was constructed for a non-browser host but the hook is
          // executing in one anyway — a misconfigured probe.
          if (process.env.NODE_ENV !== 'production') {
            warnOnce(
              'voice-skipped-in-browser',
              '[Maelstrom] voiceModulePromise resolved to "skipped" inside useEffect. This status is for non-browser probe contexts; reaching it client-side suggests a misconfigured probe.',
            );
          }
          return;
        }

        if (result.status === 'failed') {
          // State flip before the callback: an `onError` that throws (and
          // even an `onError` that triggers a synchronous snapshot read via
          // a hook) must observe `isVoiceSupported: false`, not the stale
          // pre-probe default.
          store.setIsVoiceSupported(false);
          const isMissing = isMissingModuleError(result.error);
          handleVoiceError(
            new VoiceDependencyError(
              isMissing ? 'DEPENDENCY_MISSING' : 'DEPENDENCY_BROKEN',
              isMissing ? VOICE_PEER_NOT_INSTALLED_MSG : VOICE_PEER_LOAD_FAILED_MSG,
              result.error,
            ),
          );
          return;
        }

        const VoiceSessionCtor = result.module.VoiceSession;
        if (!VoiceSessionCtor) {
          store.setIsVoiceSupported(false);
          handleVoiceError(
            new VoiceDependencyError(
              'DEPENDENCY_BROKEN',
              VOICE_SESSION_EXPORT_MISSING_MSG,
            ),
          );
          return;
        }

        const opts = hookOptionsRef.current;
        if (!opts) return;
        // `connector` is EngineConnector; VoiceSessionConfig.connector is
        // VoiceConnector (extends EngineConnector). When voiceSupported is
        // true the connector implements the full VoiceConnector surface.
        const baseConfig = {
          connector: connector as VoiceSessionConfig['connector'],
          sessionId: SessionId('default'),
          ...(opts.language && { language: opts.language }),
          useVadToFinalizeInterims: opts.useVadToFinalizeInterims ?? true,
          allowBargeIn: opts.allowBargeIn ?? true,
          vadOptions: {
            activationThreshold: 0.5,
            ...opts.vadOptions,
          },
          debugMode: config.debug,
        };
        const session = new VoiceSessionCtor(
          opts.autoAcquireMic
            ? {
                ...baseConfig,
                autoAcquireMic: true,
                ...(opts.greeting && { greeting: opts.greeting }),
              }
            : { ...baseConfig, autoAcquireMic: false },
        );

        const unsubs = [
          session.on('transcript', (text, isFinal) => {
            ownerOptionsRef?.current?.onTranscript?.(text, isFinal);
          }),
          session.on('stateChange', (s) => {
            store.setState(s);
            ownerOptionsRef?.current?.onStateChange?.(s);
          }),
          session.on('response', (r) => {
            ownerOptionsRef?.current?.onResponse?.(r);
          }),
          session.on('speechStarted', (t) => {
            ownerOptionsRef?.current?.onSpeechStarted?.(t);
          }),
          session.on('error', handleVoiceError),
          session.on('audioLevel', (level) => {
            ownerOptionsRef?.current?.onAudioLevel?.(level);
          }),
          session.on('needsUserGesture', (needsGesture) => {
            store.setNeedsUserGesture(needsGesture);
          }),
        ];

        store.claimSession(session, unsubs);
      });

      return () => {
        cancelled = true;
        if (store.getOwnerId() === myId) {
          store.unsubscribeAll();
          store.getSession()?.destroy();
          ownerOptionsRef = null;
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
      needsUserGesture: snapshot.needsUserGesture,
      ...actions,
    };
  };
}

interface VoiceSnapshot {
  state: VoiceSessionState;
  isReady: boolean;
  isVoiceSupported: boolean | undefined;
  needsUserGesture: boolean;
}

interface VoiceSessionStore {
  subscribe: (callback: () => void) => () => void;
  getSnapshot: () => VoiceSnapshot;
  getSession: () => VoiceSession | null;
  getOwnerId: () => symbol | null;
  setOwnerId: (id: symbol) => void;
  claimSession: (session: VoiceSession, unsubs: (() => void)[]) => void;
  unsubscribeAll: () => void;
  setState: (state: VoiceSessionState) => void;
  setIsVoiceSupported: (supported: boolean) => void;
  setNeedsUserGesture: (needsGesture: boolean) => void;
  reset: () => void;
}

function createVoiceSessionStore(): VoiceSessionStore {
  let session: VoiceSession | null = null;
  let ownerId: symbol | null = null;
  let eventUnsubs: (() => void)[] = [];
  let state: VoiceSessionState = 'idle';
  let isReady = false;
  let isVoiceSupported: boolean | undefined;
  let needsUserGesture = false;
  const listeners = new Set<() => void>();

  let cachedSnapshot: VoiceSnapshot = {
    state: 'idle',
    isReady: false,
    isVoiceSupported: undefined,
    needsUserGesture: false,
  };

  function getSnapshot(): VoiceSnapshot {
    if (
      cachedSnapshot.state !== state ||
      cachedSnapshot.isReady !== isReady ||
      cachedSnapshot.isVoiceSupported !== isVoiceSupported ||
      cachedSnapshot.needsUserGesture !== needsUserGesture
    ) {
      cachedSnapshot = { state, isReady, isVoiceSupported, needsUserGesture };
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
    setNeedsUserGesture: (value) => {
      needsUserGesture = value;
      notifyListeners();
    },
    reset: () => {
      session = null;
      ownerId = null;
      state = 'idle';
      isReady = false;
      isVoiceSupported = undefined;
      needsUserGesture = false;
      notifyListeners();
    },
  };
}
