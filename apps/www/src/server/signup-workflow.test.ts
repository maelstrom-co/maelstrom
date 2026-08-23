import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { ClaimDeliveryAttempt } from '../lib/waitlist-delivery-store';
import { SignupWorkflow } from './signup-workflow';
import type { TurnstileVerifierService } from './turnstile-verifier';
import { makeRepository } from './waitlist-repository';

const FIXED_NOW_ISO = '2026-08-23T12:00:00.000Z';

/** Programmable fakes; each touchpoint records itself for ordering asserts. */
const harness = (options?: {
  verify?: ReturnType<TurnstileVerifierService['verify']>;
  claim?: (input: ClaimDeliveryAttempt) => Promise<boolean>;
  sendThrows?: unknown;
  markAcceptedThrows?: boolean;
}) => {
  const events: Array<string> = [];

  const verifier: TurnstileVerifierService = {
    verify: (token, remoteIp) => {
      events.push(`verify:${token}:${remoteIp ?? ''}`);
      return options?.verify
        ? options.verify(token, remoteIp)
        : Effect.succeed(undefined);
    },
  };

  const store = {
    claimDeliveryAttempt: async (input: ClaimDeliveryAttempt) => {
      events.push(`claim:${input.email}:${input.tokenHash}`);
      return options?.claim ? options.claim(input) : true;
    },
    markAccepted: async () => {
      if (options?.markAcceptedThrows) {
        throw new Error('state update raced');
      }
      events.push('markAccepted');
    },
    markRejected: async (_id: string, failureCode: string) => {
      events.push(`markRejected:${failureCode}`);
    },
    markUnknown: async (_id: string, failureCode: string) => {
      events.push(`markUnknown:${failureCode}`);
    },
    markRetryable: async (_id: string, failureCode: string) => {
      events.push(`markRetryable:${failureCode}`);
    },
    confirmToken: async () => null,
    hasValidAccessReceipt: async () => false,
  };

  const emailService = {
    send: async () => {
      events.push('send:user@example.com');
      if (options?.sendThrows !== undefined) throw options.sendThrows;
      return { messageId: 'msg-1' };
    },
  };

  const layer = SignupWorkflow.layer({
    verifier,
    repository: makeRepository(store as never),
    emailService: emailService as never,
    nowIso: () => FIXED_NOW_ISO,
  });

  return { events, layer };
};

const begin = (
  h: ReturnType<typeof harness>,
  input?: Partial<{
    email: string;
    turnstileToken: string;
    remoteIp: string | null;
  }>,
) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const workflow = yield* SignupWorkflow;
      return yield* workflow.begin({
        email: input?.email ?? 'user@example.com',
        turnstileToken: input?.turnstileToken ?? 'tok',
        remoteIp: input?.remoteIp ?? null,
      });
    }).pipe(Effect.provide(h.layer)),
  );

const claimedIn = async (h: ReturnType<typeof harness>) => {
  const exit = await begin(h);
  if (exit._tag !== 'Success' || exit.value.kind !== 'claimed') {
    throw new Error('expected a claimed signup');
  }
  return exit.value;
};

describe('signup workflow', () => {
  test('verifies the challenge before any persistence happens', async () => {
    const h = harness({
      verify: () =>
        Effect.fail({
          _tag: 'TurnstileRejected',
          reason: 'challenge_rejected',
          providerCodes: [],
        }) as never,
    });
    const exit = await begin(h);
    expect(exit._tag).toBe('Failure');
    // Verify-before-persist: a rejected challenge must never write D1.
    expect(h.events.filter((event) => event.startsWith('claim'))).toEqual([]);
  });

  test('a suppressed claim answers uniformly and never reaches the mailer', async () => {
    const h = harness({ claim: async () => false });
    const exit = await begin(h);
    expect(exit._tag).toBe('Success');
    if (exit._tag !== 'Success') return;
    expect(exit.value.kind).toBe('suppressed');
    expect(h.events.filter((event) => event.startsWith('send'))).toEqual([]);
  });

  test('begin claims durably and never invokes the mailer itself', async () => {
    const h = harness();
    await claimedIn(h);
    // Delivery is a separate operation the handler attaches to waitUntil —
    // begin must not send on its own.
    expect(h.events.some((event) => event.startsWith('claim:'))).toBe(true);
    expect(h.events.filter((event) => event.startsWith('send'))).toEqual([]);
  });

  test('persists only the token hash and hands the raw token to delivery', async () => {
    let storedHash = '';
    const h = harness({
      claim: async (input) => {
        storedHash = input.tokenHash;
        return true;
      },
    });
    const claimed = await claimedIn(h);
    expect(storedHash).not.toBe('');
    expect(storedHash).not.toContain(claimed.token);
    expect(claimed.token.length).toBeGreaterThan(0);
    expect(claimed.attemptId).not.toBe('');
  });

  test('delivery records an accepted message id after sending', async () => {
    const h = harness();
    const claimed = await claimedIn(h);
    h.events.length = 0;
    await Effect.runPromise(
      Effect.gen(function* () {
        const workflow = yield* SignupWorkflow;
        yield* workflow.deliver(claimed);
      }).pipe(Effect.provide(h.layer)),
    );
    expect(h.events).toEqual(['send:user@example.com', 'markAccepted']);
  });

  test.each([
    ['E_VALIDATION_ERROR', 'markRejected:E_VALIDATION_ERROR'],
    ['E_RATE_LIMIT_EXCEEDED', 'markRetryable:E_RATE_LIMIT_EXCEEDED'],
    ['E_INTERNAL_SERVER_ERROR', 'markUnknown:E_INTERNAL_SERVER_ERROR'],
    ['totally-unclassified', 'markUnknown:unclassified'],
  ] as const)('classifies %s into the matching disposition', async (code, expectedEvent) => {
    const h = harness({ sendThrows: { code } });
    const claimed = await claimedIn(h);
    h.events.length = 0;
    // Delivery must never reject outward — waitUntil cannot log rejections.
    await Effect.runPromise(
      Effect.gen(function* () {
        const workflow = yield* SignupWorkflow;
        yield* workflow.deliver(claimed);
      }).pipe(Effect.provide(h.layer)),
    );
    expect(h.events[0]).toBe('send:user@example.com');
    expect(h.events[1]).toBe(expectedEvent);
  });

  test('a failed state transition still resolves delivery', async () => {
    const h = harness({ markAcceptedThrows: true });
    const claimed = await claimedIn(h);
    const outcome = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const workflow = yield* SignupWorkflow;
        yield* workflow.deliver(claimed);
      }).pipe(Effect.provide(h.layer)),
    );
    expect(outcome._tag).toBe('Success');
  });
});
