import { useStore } from '@tanstack/react-store';
import { useCallback, useState } from 'react';

import type { MaelstromContextPair } from './context.js';
import type { MaelstromState } from './maelstrom-state-types.js';

export function createUseMaelstrom(contextPair: MaelstromContextPair) {
  const { useMaelstromContext } = contextPair;

  return function useMaelstrom(): MaelstromState {
    const { orchestrator, onErrorRef } = useMaelstromContext();

    const [lastError, setLastError] = useState<Error | null>(null);

    const connectionStatus = useStore(
      orchestrator.connectionManager.store,
      (s) => s.connectionStatus,
    );

    const connectionError = useStore(
      orchestrator.connectionManager.store,
      (s) => s.connectionError,
    );

    const isProcessing = useStore(
      orchestrator.requestCoordinator.store,
      (s) => s.isProcessing,
    );

    const processIntent = useCallback(
      async (intent: string): Promise<void> => {
        setLastError(null);
        try {
          await orchestrator.processIntent(intent);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          setLastError(error);
          onErrorRef.current?.(error);
        }
      },
      [orchestrator, onErrorRef],
    );

    return {
      processIntent,
      connectionStatus,
      connectionError,
      isProcessing,
      lastError,
      sessionId: orchestrator.getConfig().sessionId,
    };
  };
}
