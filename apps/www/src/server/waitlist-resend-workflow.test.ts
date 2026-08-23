import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { ClaimResendAttempt } from '../lib/waitlist-delivery-store';
import { makeRepository } from './waitlist-repository';
import { WaitlistResendWorkflow } from './waitlist-resend-workflow';

const NOW = '2026-08-23T12:00:00.000Z';

const harness = (options?: {
  claim?: (input: ClaimResendAttempt) => Promise<boolean>;
  sendResult?: Promise<{ messageId?: string }>;
  sendThrows?: unknown;
  transitionThrows?: boolean;
}) => {
  const events: string[] = [];
  const store = {
    claimResendAttempt: async (input: ClaimResendAttempt) => {
      events.push(`claim:${input.email}:${input.cooldownSince}`);
      return options?.claim ? options.claim(input) : true;
    },
    markResendAccepted: async () => {
      events.push('accepted');
      if (options?.transitionThrows) throw new Error('private D1 detail');
    },
    markResendRejected: async (_id: string, code: string) =>
      events.push(`rejected:${code}`),
    markResendUnknown: async (_id: string, code: string) =>
      events.push(`unknown:${code}`),
    markResendRetryable: async (_id: string, code: string) =>
      events.push(`retryable:${code}`),
  };
  const emailService = {
    send: async (message: { to: string; subject: string }) => {
      events.push(`send:${message.to}:${message.subject}`);
      if (options && 'sendThrows' in options) throw options.sendThrows;
      return options?.sendResult
        ? options.sendResult
        : { messageId: 'message-1' };
    },
  };
  const layer = WaitlistResendWorkflow.layer({
    repository: makeRepository(store as never),
    emailService: emailService as never,
    nowIso: () => NOW,
  });
  return { events, layer };
};

const begin = (h: ReturnType<typeof harness>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const workflow = yield* WaitlistResendWorkflow;
      return yield* workflow.begin('user@example.com');
    }).pipe(Effect.provide(h.layer)),
  );

const deliver = (
  h: ReturnType<typeof harness>,
  delivery: Awaited<ReturnType<typeof begin>>,
) => {
  if (delivery.kind !== 'claimed') throw new Error('expected claimed resend');
  return Effect.runPromise(
    Effect.gen(function* () {
      const workflow = yield* WaitlistResendWorkflow;
      yield* workflow.deliver(delivery);
    }).pipe(Effect.provide(h.layer)),
  );
};

describe('waitlist resend workflow', () => {
  test('claims with a durable ten-minute cooldown before sending', async () => {
    const h = harness();
    const result = await begin(h);
    expect(result.kind).toBe('claimed');
    expect(h.events).toEqual([
      'claim:user@example.com:2026-08-23T11:50:00.000Z',
    ]);
  });

  test('suppresses an unclaimed address without sending', async () => {
    const h = harness({ claim: async () => false });
    expect((await begin(h)).kind).toBe('suppressed');
    expect(h.events.some((event) => event.startsWith('send:'))).toBe(false);
  });

  test('reuses the invitation email and records acceptance', async () => {
    const h = harness();
    await deliver(h, await begin(h));
    expect(h.events[1]).toContain(
      'send:user@example.com:Join the Maelstrom beta community',
    );
    expect(h.events[2]).toBe('accepted');
  });

  test.each([
    [{ code: 'E_RECIPIENT_SUPPRESSED' }, 'rejected:E_RECIPIENT_SUPPRESSED'],
    [{ code: 'E_RATE_LIMIT_EXCEEDED' }, 'retryable:E_RATE_LIMIT_EXCEEDED'],
    [{ code: 'E_INTERNAL_SERVER_ERROR' }, 'unknown:E_INTERNAL_SERVER_ERROR'],
    [new Error('private provider detail'), 'unknown:unclassified'],
  ] as const)('consumes delivery failure and records its stable disposition', async (failure, expected) => {
    const h = harness({ sendThrows: failure });
    await deliver(h, await begin(h));
    expect(h.events.at(-1)).toBe(expected);
  });

  test('consumes a missing provider message id', async () => {
    const h = harness({ sendResult: Promise.resolve({}) });
    await expect(deliver(h, await begin(h))).resolves.toBeUndefined();
    expect(h.events.at(-1)).toBe('unknown:unclassified');
  });

  test('consumes a failed accepted-state transition', async () => {
    const h = harness({ transitionThrows: true });
    await expect(deliver(h, await begin(h))).resolves.toBeUndefined();
    expect(h.events.at(-1)).toBe('accepted');
  });
});
