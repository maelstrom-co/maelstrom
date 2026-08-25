import { Effect } from 'effect';
import {
  DeliveryStateConflictError,
  type WaitlistDeliveryStore,
} from '../lib/waitlist-delivery-store';
import {
  DeliveryStateConflict,
  type WaitlistOperation,
  WaitlistPersistenceError,
  type WaitlistRepositoryError,
  type WaitlistRepositoryService,
} from './waitlist-repository';

type RawStore = Pick<
  WaitlistDeliveryStore,
  | 'claimDeliveryAttempt'
  | 'claimResendAttempt'
  | 'markAccepted'
  | 'markRejected'
  | 'markUnknown'
  | 'markRetryable'
  | 'markResendAccepted'
  | 'markResendRejected'
  | 'markResendUnknown'
  | 'markResendRetryable'
  | 'confirmToken'
  | 'hasValidAccessReceipt'
>;

const persist = <A>(
  operation: WaitlistOperation,
  run: () => Promise<A>,
): Effect.Effect<A, WaitlistRepositoryError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      cause instanceof DeliveryStateConflictError
        ? new DeliveryStateConflict({})
        : new WaitlistPersistenceError({ operation }),
  });

const omittedOperation = (operation: WaitlistOperation): never => {
  throw new Error(`Waitlist repository test operation omitted: ${operation}`);
};

/** Preserves typed repository failure mapping for partial raw-store implementations. */
export const makeRawStoreTestRepository = (
  overrides: Partial<RawStore>,
  onOperation?: (operation: WaitlistOperation) => void,
): WaitlistRepositoryService => {
  const store: RawStore = {
    claimDeliveryAttempt: async () => omittedOperation('claimDeliveryAttempt'),
    claimResendAttempt: async () => omittedOperation('claimResendAttempt'),
    markAccepted: async () => omittedOperation('markAccepted'),
    markRejected: async () => omittedOperation('markRejected'),
    markUnknown: async () => omittedOperation('markUnknown'),
    markRetryable: async () => omittedOperation('markRetryable'),
    markResendAccepted: async () => omittedOperation('markResendAccepted'),
    markResendRejected: async () => omittedOperation('markResendRejected'),
    markResendUnknown: async () => omittedOperation('markResendUnknown'),
    markResendRetryable: async () => omittedOperation('markResendRetryable'),
    confirmToken: async () => omittedOperation('confirmToken'),
    hasValidAccessReceipt: async () =>
      omittedOperation('hasValidAccessReceipt'),
    ...overrides,
  };
  const run = <A>(operation: WaitlistOperation, effect: () => Promise<A>) => {
    onOperation?.(operation);
    return persist(operation, effect);
  };

  return {
    claimDeliveryAttempt: (input) =>
      run('claimDeliveryAttempt', () => store.claimDeliveryAttempt(input)),
    claimResendAttempt: (input) =>
      run('claimResendAttempt', () => store.claimResendAttempt(input)),
    markAccepted: (id, messageId, changedAt) =>
      run('markAccepted', () => store.markAccepted(id, messageId, changedAt)),
    markRejected: (id, failureCode, changedAt) =>
      run('markRejected', () => store.markRejected(id, failureCode, changedAt)),
    markUnknown: (id, failureCode, changedAt) =>
      run('markUnknown', () => store.markUnknown(id, failureCode, changedAt)),
    markRetryable: (id, failureCode, changedAt) =>
      run('markRetryable', () =>
        store.markRetryable(id, failureCode, changedAt),
      ),
    markResendAccepted: (id, messageId, changedAt) =>
      run('markResendAccepted', () =>
        store.markResendAccepted(id, messageId, changedAt),
      ),
    markResendRejected: (id, failureCode, changedAt) =>
      run('markResendRejected', () =>
        store.markResendRejected(id, failureCode, changedAt),
      ),
    markResendUnknown: (id, failureCode, changedAt) =>
      run('markResendUnknown', () =>
        store.markResendUnknown(id, failureCode, changedAt),
      ),
    markResendRetryable: (id, failureCode, changedAt) =>
      run('markResendRetryable', () =>
        store.markResendRetryable(id, failureCode, changedAt),
      ),
    confirmToken: (tokenHash, now, receipt) =>
      run('confirmToken', () => store.confirmToken(tokenHash, now, receipt)),
    hasValidAccessReceipt: (receiptHash, now) =>
      run('hasValidAccessReceipt', () =>
        store.hasValidAccessReceipt(receiptHash, now),
      ),
  };
};
