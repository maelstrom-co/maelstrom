import type {
  IntentResult,
  IntentScope,
  IntentSnapshot,
  IntentSubmission,
} from '@maelstrom-co/client';
import { Store } from '@tanstack/store';

export function createPreparationAdmission() {
  let sealed = false;
  let uncertain = false;
  let finishRetirement!: () => void;
  const retired = new Promise<void>((resolve) => {
    finishRetirement = resolve;
  });
  const pending = new Set<Promise<IntentResult>>();
  const scopes = new Set<IntentScope>();
  const refused = (): IntentSubmission => {
    const result: IntentResult = {
      status: 'not_submitted',
      reason: 'owner_retired',
    };
    return {
      id: crypto.randomUUID(),
      accepted: false,
      store: new Store<IntentSnapshot>(result),
      result: Promise.resolve(result),
    };
  };
  return {
    wrap(scope: IntentScope): IntentScope {
      scopes.add(scope);
      let retired = false;
      return {
        enqueueIntent(intent) {
          if (sealed || retired) return refused();
          const ticket = scope.enqueueIntent(intent);
          if (ticket.accepted) {
            pending.add(ticket.result);
            void ticket.result.then((result) => {
              if (result.status !== 'applied') uncertain = true;
              pending.delete(ticket.result);
            });
          }
          return ticket;
        },
        retire() {
          retired = true;
          scope.retire();
          scopes.delete(scope);
        },
      };
    },
    async seal() {
      sealed = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([...pending]),
          retired.then(() => {
            throw new Error('Preparation session retired.');
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    'Preparation settlement timed out. Check the outline before trying again.',
                  ),
                ),
              65000,
            );
          }),
        ]);
        if (uncertain)
          throw new Error(
            'Preparation outcome not confirmed. Check the outline before trying again.',
          );
      } finally {
        clearTimeout(timer);
      }
    },
    retire() {
      sealed = true;
      finishRetirement();
      for (const scope of scopes) scope.retire();
      scopes.clear();
    },
  };
}
