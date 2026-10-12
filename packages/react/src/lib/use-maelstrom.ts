import type { EnqueueIntentOptions } from '@maelstrom-co/client';
import { type MaelstromResponse, toError } from '@maelstrom-co/protocol';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { MaelstromContextPair } from './context.js';
import type { MaelstromState } from './maelstrom-state-types.js';
import { useStoreSelector } from './use-store-selector.js';
export function createUseMaelstrom(contextPair: MaelstromContextPair) {
  const { useMaelstromContext } = contextPair;

  function useMaelstrom(): MaelstromState;
  function useMaelstrom<T>(selector: (state: MaelstromState) => T): T;
  function useMaelstrom<T>(
    selector?: (state: MaelstromState) => T,
  ): MaelstromState | T {
    const { orchestrator, onErrorRef, config } = useMaelstromContext();

    const [lastError, setLastError] = useState<Error | null>(null);
    const [lastResponse, setLastResponse] = useState<MaelstromResponse | null>(
      null,
    );

    const processIntent = useCallback(
      async (intent: string): Promise<void> => {
        setLastError(null);
        setLastResponse(null);
        try {
          const response = await orchestrator.processIntent(intent);
          setLastResponse(response);
        } catch (err) {
          const error = toError(err);
          setLastError(error);
          if (config.debug && !onErrorRef.current) {
            console.warn('[Maelstrom] processIntent failed:', error);
          }
          onErrorRef.current?.(error);
        }
      },
      [orchestrator, onErrorRef, config.debug],
    );

    const enqueueIntent = useCallback(
      (intent: string, options?: EnqueueIntentOptions) =>
        orchestrator.enqueueIntent(intent, options),
      [orchestrator],
    );

    // Keep refs for values managed by React state (not external stores)
    // so they can be read inside buildSnapshot without stale closures
    const processIntentRef = useRef(processIntent);
    processIntentRef.current = processIntent;
    const lastErrorRef = useRef(lastError);
    lastErrorRef.current = lastError;
    const lastResponseRef = useRef(lastResponse);
    lastResponseRef.current = lastResponse;

    const stores = useMemo(
      () => [
        orchestrator.connectionManager.store,
        orchestrator.requestCoordinator.store,
        orchestrator.intentScheduler.store,
      ],
      [orchestrator],
    );

    const buildSnapshot = (): MaelstromState => {
      const connState = orchestrator.connectionManager.store.state;
      const reqState = orchestrator.requestCoordinator.store.state;
      return {
        processIntent: processIntentRef.current,
        enqueueIntent,
        intentScheduler: orchestrator.intentScheduler.store.state,
        connectionStatus: connState.connectionStatus,
        connectionError: connState.connectionError,
        isProcessing: reqState.isProcessing,
        lastError: lastErrorRef.current,
        lastResponse: lastResponseRef.current,
        sessionId: orchestrator.getConfig().sessionId,
      };
    };

    return useStoreSelector(stores, buildSnapshot, selector);
  }

  return useMaelstrom;
}
