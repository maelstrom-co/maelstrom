import type { IntentSnapshot, IntentSubmission } from '@maelstrom-co/client';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Observe a client ticket through atomic application settlement, or null before
 * submission. Subscription cleanup never cancels work. Operational failures are
 * terminal snapshots, not thrown errors; unknown must not be retried automatically.
 */
export function useIntentSubmission(
  submission: IntentSubmission | null,
): IntentSnapshot | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = submission?.store.subscribe(onChange);
      return () => subscription?.unsubscribe();
    },
    [submission],
  );
  const getSnapshot = useCallback(
    () => submission?.store.state ?? null,
    [submission],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
