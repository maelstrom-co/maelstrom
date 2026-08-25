import { describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import {
  type ClaimDeliveryAttempt,
  type ClaimResendAttempt,
  DeliveryStateConflictError,
} from '../lib/waitlist-delivery-store';
import type {
  WaitlistRepositoryError,
  WaitlistRepositoryService,
} from './waitlist-repository';
import { WaitlistRepository } from './waitlist-repository';
import { makeRawStoreTestRepository } from './waitlist-repository.test-support';

const claimInput: ClaimDeliveryAttempt = {
  id: 'attempt-1',
  email: 'user@example.com',
  tokenHash: 'hash-sentinel',
  expiresAt: '2026-08-23T00:00:00.000Z',
  attemptedAt: '2026-08-22T00:00:00.000Z',
  cooldownSince: '2026-08-21T23:50:00.000Z',
};
const resendInput: ClaimResendAttempt = {
  id: 'resend-1',
  email: 'user@example.com',
  attemptedAt: '2026-08-22T00:00:00.000Z',
  cooldownSince: '2026-08-21T23:50:00.000Z',
};

type StoreShape = {
  claimDeliveryAttempt(input: ClaimDeliveryAttempt): Promise<boolean>;
  claimResendAttempt(input: ClaimResendAttempt): Promise<boolean>;
  markAccepted(id: string, messageId: string, changedAt: string): Promise<void>;
  markRejected(
    id: string,
    failureCode: string,
    changedAt: string,
  ): Promise<void>;
  markUnknown(
    id: string,
    failureCode: string,
    changedAt: string,
  ): Promise<void>;
  markRetryable(
    id: string,
    failureCode: string,
    changedAt: string,
  ): Promise<void>;
  markResendAccepted(
    id: string,
    messageId: string,
    changedAt: string,
  ): Promise<void>;
  markResendRejected(
    id: string,
    failureCode: string,
    changedAt: string,
  ): Promise<void>;
  markResendUnknown(
    id: string,
    failureCode: string,
    changedAt: string,
  ): Promise<void>;
  markResendRetryable(
    id: string,
    failureCode: string,
    changedAt: string,
  ): Promise<void>;
  confirmToken(
    tokenHash: string,
    now: string,
    receipt?: { hash: string; expiresAt: string },
  ): Promise<{ email: string } | null>;
  hasValidAccessReceipt(receiptHash: string, now: string): Promise<boolean>;
};

/**
 * Store double whose methods are programmable; failures throw exactly what
 * D1/store code would (generic errors and DeliveryStateConflictError).
 */
const storeLayerWith = (
  overrides: Partial<StoreShape>,
  calls: { operations: Array<string> },
): Layer.Layer<WaitlistRepository> => {
  return Layer.succeed(
    WaitlistRepository,
    makeRawStoreTestRepository(overrides, (operation) =>
      calls.operations.push(operation),
    ),
  );
};

const run = (
  layer: Layer.Layer<WaitlistRepository>,
  program: (
    repo: WaitlistRepositoryService,
  ) => Effect.Effect<unknown, WaitlistRepositoryError>,
) =>
  Effect.gen(function* () {
    const repo = yield* WaitlistRepository;
    return yield* program(repo);
  }).pipe(Effect.provide(layer));

const expectNoCauseOrRenderedSecret = (error: unknown, secret: string) => {
  const errorObject = Object(error);
  expect(Object.hasOwn(errorObject, 'cause')).toBe(false);
  expect(Reflect.has(errorObject, 'cause')).toBe(false);
  expect(String(error)).not.toContain(secret);
  if (error instanceof Error) expect(error.stack ?? '').not.toContain(secret);
};

describe('waitlist repository', () => {
  test('claims a delivery attempt through to the store', async () => {
    const calls = { operations: [] };
    const layer = storeLayerWith(
      { claimDeliveryAttempt: async () => true },
      calls,
    );
    const result = await Effect.runPromise(
      run(layer, (repo) => repo.claimDeliveryAttempt(claimInput)),
    );
    expect(result).toBe(true);
    expect(calls.operations).toEqual(['claimDeliveryAttempt']);
  });

  test('claims a confirmed resend through the typed repository seam', async () => {
    const calls = { operations: [] };
    const layer = storeLayerWith(
      { claimResendAttempt: async () => true },
      calls,
    );
    const result = await Effect.runPromise(
      run(layer, (repo) => repo.claimResendAttempt(resendInput)),
    );
    expect(result).toBe(true);
    expect(calls.operations).toEqual(['claimResendAttempt']);
  });

  test('names resend persistence failures without leaking subscriber identity', async () => {
    const layer = storeLayerWith(
      {
        claimResendAttempt: async () => {
          throw new Error('user@example.com');
        },
      },
      { operations: [] },
    );
    const error = await Effect.runPromise(
      Effect.flip(run(layer, (repo) => repo.claimResendAttempt(resendInput))),
    );
    expect(error).toMatchObject({
      _tag: 'WaitlistPersistenceError',
      operation: 'claimResendAttempt',
    });
    expect(JSON.stringify(error)).not.toContain('user@example.com');
    expectNoCauseOrRenderedSecret(error, 'user@example.com');
  });

  test('maps a store failure to a typed persistence error naming the operation', async () => {
    const layer = storeLayerWith(
      {
        claimDeliveryAttempt: async () => {
          throw new Error('D1 unavailable');
        },
      },
      { operations: [] },
    );
    const error = await Effect.runPromise(
      Effect.flip(run(layer, (repo) => repo.claimDeliveryAttempt(claimInput))),
    );
    expect(error._tag).toBe('WaitlistPersistenceError');
    if (error._tag !== 'WaitlistPersistenceError') return;
    expect(error.operation).toBe('claimDeliveryAttempt');
    // Raw causes may carry provider payloads; they must not reach callers.
    expect(JSON.stringify(error)).not.toContain('D1 unavailable');
    expectNoCauseOrRenderedSecret(error, 'D1 unavailable');
  });

  test('maps a missing or incompatible transition to DeliveryStateConflict', async () => {
    const layer = storeLayerWith(
      {
        markRetryable: async () => {
          throw new DeliveryStateConflictError();
        },
      },
      { operations: [] },
    );
    const error = await Effect.runPromise(
      Effect.flip(
        run(layer, (repo) =>
          repo.markRetryable(
            'attempt-1',
            'E_RATE_LIMIT_EXCEEDED',
            '2026-08-22T00:00:00.000Z',
          ),
        ),
      ),
    );
    expect(error._tag).toBe('DeliveryStateConflict');
  });

  test.each([
    ['markAccepted', ['attempt-1', 'msg-1', '2026-08-22T00:00:00.000Z']],
    [
      'markRejected',
      ['attempt-1', 'E_VALIDATION_ERROR', '2026-08-22T00:00:00.000Z'],
    ],
    ['markUnknown', ['attempt-1', 'unclassified', '2026-08-22T00:00:00.000Z']],
    [
      'markRetryable',
      ['attempt-1', 'E_RATE_LIMIT_EXCEEDED', '2026-08-22T00:00:00.000Z'],
    ],
  ] as const)('%s resolves when the transition lands once', async (op, args) => {
    const layer = storeLayerWith(
      {
        markAccepted: async () => {},
        markRejected: async () => {},
        markUnknown: async () => {},
        markRetryable: async () => {},
      },
      { operations: [] },
    );
    const outcome = await Effect.runPromiseExit(
      run(layer, (repo) => repo[op](args[0], args[1], args[2])),
    );
    expect(outcome._tag).toBe('Success');
  });

  test('fails when an operation was omitted from a partial repository double', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        run(storeLayerWith({}, { operations: [] }), (repo) =>
          repo.claimDeliveryAttempt(claimInput),
        ),
      ),
    );

    expect(error).toMatchObject({
      _tag: 'WaitlistPersistenceError',
      operation: 'claimDeliveryAttempt',
    });
  });

  test('confirm returns the confirmed email for the receipt cookie flow', async () => {
    const layer = storeLayerWith(
      {
        confirmToken: async () => ({ email: 'confirmed@example.com' }),
      },
      { operations: [] },
    );
    const confirmed = await Effect.runPromise(
      run(layer, (repo) =>
        repo.confirmToken('hash-sentinel', '2026-08-22T00:00:00.000Z', {
          hash: 'receipt-hash',
          expiresAt: '2026-08-22T01:00:00.000Z',
        }),
      ),
    );
    expect(confirmed).toEqual({ email: 'confirmed@example.com' });
  });

  test('confirm failure names the operation without leaking the token hash', async () => {
    const layer = storeLayerWith(
      {
        confirmToken: async () => {
          throw new Error('boom');
        },
      },
      { operations: [] },
    );
    const error = await Effect.runPromise(
      Effect.flip(
        run(layer, (repo) =>
          repo.confirmToken('hash-sentinel', '2026-08-22T00:00:00.000Z'),
        ),
      ),
    );
    expect(error._tag).toBe('WaitlistPersistenceError');
    if (error._tag !== 'WaitlistPersistenceError') return;
    expect(error.operation).toBe('confirmToken');
    expect(JSON.stringify(error)).not.toContain('hash-sentinel');
    expect(JSON.stringify(error)).not.toContain('boom');
    expectNoCauseOrRenderedSecret(error, 'boom');
  });

  test('receipt validation passes the verdict through unchanged', async () => {
    const layer = storeLayerWith(
      { hasValidAccessReceipt: async () => true },
      { operations: [] },
    );
    const valid = await Effect.runPromise(
      run(layer, (repo) =>
        repo.hasValidAccessReceipt('receipt-hash', '2026-08-22T00:30:00.000Z'),
      ),
    );
    expect(valid).toBe(true);
  });
});
