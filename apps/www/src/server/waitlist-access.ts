import { Data, Effect } from 'effect';
import { hashWaitlistToken, isWaitlistToken } from '../lib/waitlist-token';
import { WaitlistRepository } from './waitlist-repository';

type ReceiptFailureCategory =
  | 'receipt_persistence_failed'
  | 'receipt_hash_failed'
  | 'receipt_runtime_unavailable';

class ReceiptHashError extends Data.TaggedError('ReceiptHashError')<
  Record<string, never>
> {}

const denyWithDiagnostic = (category: ReceiptFailureCategory) =>
  Effect.sync(() => {
    console.error({
      message: 'waitlist receipt access denied',
      category,
    });
    return false;
  });

/**
 * Fails closed when receipt hashing or persistence fails and emits only a
 * stable category, because causes can contain receipt or provider data.
 */
export const hasValidWaitlistReceipt = async (
  database: D1Database,
  receipt: string | undefined,
  now: string,
): Promise<boolean> => {
  if (!receipt || !isWaitlistToken(receipt)) return false;

  return Effect.runPromise(
    Effect.gen(function* () {
      const receiptHash = yield* Effect.tryPromise({
        try: () => hashWaitlistToken(receipt),
        catch: () => new ReceiptHashError({}),
      });
      const repository = yield* WaitlistRepository;
      return yield* repository.hasValidAccessReceipt(receiptHash, now);
    }).pipe(
      Effect.provide(WaitlistRepository.layer(database)),
      Effect.catchTag('ReceiptHashError', () =>
        denyWithDiagnostic('receipt_hash_failed'),
      ),
      Effect.catchTag('WaitlistPersistenceError', () =>
        denyWithDiagnostic('receipt_persistence_failed'),
      ),
      Effect.catchTag('DeliveryStateConflict', () =>
        denyWithDiagnostic('receipt_persistence_failed'),
      ),
    ),
  );
};

/**
 * Denies access and emits a redacted diagnostic when the Worker runtime cannot
 * provide D1; callers must not distinguish infrastructure failure from denial.
 */
export const hasProductionWaitlistReceipt = async (options: {
  readonly receipt: string | undefined;
  readonly now: string;
  readonly loadDatabase: () => Promise<D1Database | undefined>;
}): Promise<boolean> => {
  if (!options.receipt || !isWaitlistToken(options.receipt)) return false;

  try {
    const database = await options.loadDatabase();
    if (!database) {
      return Effect.runPromise(
        denyWithDiagnostic('receipt_runtime_unavailable'),
      );
    }
    return await hasValidWaitlistReceipt(
      database,
      options.receipt,
      options.now,
    );
  } catch {
    return Effect.runPromise(denyWithDiagnostic('receipt_runtime_unavailable'));
  }
};
