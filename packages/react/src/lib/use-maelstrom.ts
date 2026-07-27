import { toError } from '@maelstrom-co/protocol';
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

    const processIntent = useCallback(
      async (intent: string): Promise<void> => {
        setLastError(null);
        try {
          await orchestrator.processIntent(intent);
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

    // Keep refs for values managed by React state (not external stores)
    // so they can be read inside buildSnapshot without stale closures
    const processIntentRef = useRef(processIntent);
    processIntentRef.current = processIntent;
    const lastErrorRef = useRef(lastError);
    lastErrorRef.current = lastError;

    const stores = useMemo(
      () => [
        orchestrator.connectionManager.store,
        orchestrator.requestCoordinator.store,
      ],
      [orchestrator],
    );

    const buildSnapshot = (): MaelstromState => {
      const connState = orchestrator.connectionManager.store.state;
      const reqState = orchestrator.requestCoordinator.store.state;
      return {
        processIntent: processIntentRef.current,
        connectionStatus: connState.connectionStatus,
        connectionError: connState.connectionError,
        isProcessing: reqState.isProcessing,
        lastError: lastErrorRef.current,
        sessionId: orchestrator.getConfig().sessionId,
      };
    };

    return useStoreSelector(stores, buildSnapshot, selector);
  }

  return useMaelstrom;
}
