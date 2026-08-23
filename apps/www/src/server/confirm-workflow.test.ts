import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { isWaitlistToken } from '../lib/waitlist-token';
import { ConfirmWorkflow } from './confirm-workflow';
import type { AccessReceipt } from './waitlist-repository';
import { makeRepository } from './waitlist-repository';

const FIXED_NOW_ISO = '2026-08-23T12:00:00.000Z';
const LIVE_TOKEN = `v1.${'a'.repeat(43)}`;

/** Programmable fakes; each touchpoint records itself for ordering asserts. */
const harness = (options?: {
  confirm?: (
    tokenHash: string,
    now: string,
    receipt?: AccessReceipt,
  ) => Promise<{ email: string } | null>;
  sendThrows?: unknown;
  sendMessageId?: string | null;
}) => {
  const events: Array<string> = [];
  const lastConfirm: {
    current: {
      tokenHash: string;
      now: string;
      receipt?: AccessReceipt;
    } | null;
  } = { current: null };

  const store = {
    claimDeliveryAttempt: async () => false,
    markAccepted: async () => {},
    markRejected: async () => {},
    markUnknown: async () => {},
    markRetryable: async () => {},
    confirmToken: async (
      tokenHash: string,
      now: string,
      receipt?: AccessReceipt,
    ) => {
      lastConfirm.current = { tokenHash, now, receipt };
      events.push(`confirm:${tokenHash}`);
      return options?.confirm
        ? options.confirm(tokenHash, now, receipt)
        : { email: 'user@example.com' };
    },
    hasValidAccessReceipt: async () => false,
  };

  const emailService = {
    send: async (message: { to?: string }) => {
      events.push(`send:${message.to ?? ''}`);
      if (options?.sendThrows !== undefined) throw options.sendThrows;
      return { messageId: options?.sendMessageId ?? 'msg-1' };
    },
  };

  const layer = ConfirmWorkflow.layer({
    repository: makeRepository(store as never),
    emailService: emailService as never,
    nowIso: () => FIXED_NOW_ISO,
  });

  return { events, lastConfirm, layer };
};

const begin = (h: ReturnType<typeof harness>, token = LIVE_TOKEN) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const workflow = yield* ConfirmWorkflow;
      return yield* workflow.begin({ token });
    }).pipe(Effect.provide(h.layer)),
  );

describe('confirm workflow', () => {
  test('a live confirm returns the raw receipt and persists only hashes', async () => {
    const h = harness();
    const exit = await begin(h);
    expect(exit._tag).toBe('Success');
    if (exit._tag !== 'Success') return;
    expect(exit.value.kind).toBe('confirmed');
    if (exit.value.kind !== 'confirmed') return;

    expect(exit.value.email).toBe('user@example.com');
    expect(isWaitlistToken(exit.value.receipt)).toBe(true);
    expect(h.lastConfirm.current?.now).toBe(FIXED_NOW_ISO);
    expect(h.lastConfirm.current?.tokenHash).toBeTruthy();
    expect(h.lastConfirm.current?.tokenHash).not.toContain(LIVE_TOKEN);
    expect(h.lastConfirm.current?.receipt?.hash).toBeTruthy();
    expect(h.lastConfirm.current?.receipt?.hash).not.toBe(exit.value.receipt);
    expect(h.lastConfirm.current?.receipt?.expiresAt).toBe(
      '2026-08-23T13:00:00.000Z',
    );
    expect(h.events.filter((event) => event.startsWith('send'))).toEqual([]);
  });

  test('an expired or already-used token is invalid and yields no receipt', async () => {
    const h = harness({ confirm: async () => null });
    const exit = await begin(h);
    expect(exit._tag).toBe('Success');
    if (exit._tag !== 'Success') return;
    expect(exit.value).toEqual({ kind: 'invalid' });
    expect(h.lastConfirm.current?.tokenHash).toBeTruthy();
  });

  test('delivery sends the invitation after a live confirm and never rejects', async () => {
    const h = harness();
    const exit = await begin(h);
    expect(exit._tag).toBe('Success');
    if (exit._tag !== 'Success' || exit.value.kind !== 'confirmed') return;
    h.events.length = 0;
    await Effect.runPromise(
      Effect.gen(function* () {
        const workflow = yield* ConfirmWorkflow;
        yield* workflow.deliver({ email: exit.value.email });
      }).pipe(Effect.provide(h.layer)),
    );
    expect(h.events).toEqual(['send:user@example.com']);
  });

  test('a missing mailer logs unavailability and still resolves delivery', async () => {
    const errorLog: Array<unknown> = [];
    const original = console.error;
    console.error = (value: unknown) => {
      errorLog.push(value);
    };
    try {
      const store = {
        claimDeliveryAttempt: async () => false,
        markAccepted: async () => {},
        markRejected: async () => {},
        markUnknown: async () => {},
        markRetryable: async () => {},
        confirmToken: async () => ({ email: 'user@example.com' }),
        hasValidAccessReceipt: async () => false,
      };
      const layer = ConfirmWorkflow.layer({
        repository: makeRepository(store as never),
        nowIso: () => FIXED_NOW_ISO,
      });
      const outcome = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const workflow = yield* ConfirmWorkflow;
          yield* workflow.deliver({ email: 'user@example.com' });
        }).pipe(Effect.provide(layer)),
      );
      expect(outcome._tag).toBe('Success');
      expect(errorLog).toContainEqual({
        message: 'waitlist invitation email failed',
        category: 'invitation_email_unavailable',
      });
    } finally {
      console.error = original;
    }
  });

  test('a failed invitation send still resolves delivery', async () => {
    const errorLog: Array<unknown> = [];
    const original = console.error;
    console.error = (value: unknown) => {
      errorLog.push(value);
    };
    try {
      const h = harness({ sendThrows: new Error('private provider detail') });
      const outcome = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const workflow = yield* ConfirmWorkflow;
          yield* workflow.deliver({ email: 'user@example.com' });
        }).pipe(Effect.provide(h.layer)),
      );
      expect(outcome._tag).toBe('Success');
      expect(errorLog).toContainEqual({
        message: 'waitlist invitation email failed',
        category: 'invitation_email_failed',
      });
      expect(JSON.stringify(errorLog)).not.toContain('private provider detail');
    } finally {
      console.error = original;
    }
  });
});
