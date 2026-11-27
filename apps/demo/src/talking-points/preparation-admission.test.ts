import type {
  IntentResult,
  IntentScope,
  IntentSubmission,
} from '@maelstrom-co/client';
import { expect, it, vi } from 'vitest';

import { createPreparationAdmission } from './preparation-admission';

it('seals both intake scopes and waits for each accepted operation result, never queue idle', async () => {
  let resolve!: (result: IntentResult) => void;
  const ticket = {
    accepted: true,
    result: new Promise<IntentResult>((done) => {
      resolve = done;
    }),
  } as IntentSubmission;
  const underlying: IntentScope = {
    enqueueIntent: vi.fn(() => ticket),
    retire: vi.fn(),
  };
  const barrier = createPreparationAdmission();
  const voice = barrier.wrap(underlying);
  const text = barrier.wrap(underlying);
  voice.enqueueIntent('edit');
  let frozen = false;
  const sealing = barrier.seal().then(() => {
    frozen = true;
  });
  expect(text.enqueueIntent('late').accepted).toBe(false);
  await Promise.resolve();
  expect(frozen).toBe(false);
  resolve({ status: 'applied', response: {} as never });
  await sealing;
  expect(frozen).toBe(true);
});
it('unknown is a failed Start barrier, not proof of settled application or permission to replay', async () => {
  const barrier = createPreparationAdmission();
  barrier
    .wrap({
      enqueueIntent: () =>
        ({
          accepted: true,
          result: Promise.resolve({
            status: 'unknown',
            error: new Error('lost'),
          }),
        }) as IntentSubmission,
      retire: vi.fn(),
    })
    .enqueueIntent('edit');
  await expect(barrier.seal()).rejects.toThrow(/not confirmed/);
});

it('preserves tickets and fails a bounded Start when accepted application outcome never arrives', async () => {
  vi.useFakeTimers();
  const ticket = {
    accepted: true,
    result: new Promise(() => {}),
  } as IntentSubmission;
  const barrier = createPreparationAdmission();
  expect(
    barrier
      .wrap({ enqueueIntent: () => ticket, retire: vi.fn() })
      .enqueueIntent('edit'),
  ).toBe(ticket);
  const failed = expect(barrier.seal()).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(65000);
  await failed;
  vi.useRealTimers();
});

it('retiring scopes never relabels an already active operation result', async () => {
  let resolve!: (result: IntentResult) => void;
  const ticket = {
    accepted: true,
    result: new Promise<IntentResult>((done) => {
      resolve = done;
    }),
  } as IntentSubmission;
  const retire = vi.fn();
  const barrier = createPreparationAdmission();
  const scope = barrier.wrap({ enqueueIntent: () => ticket, retire });
  expect(scope.enqueueIntent('edit')).toBe(ticket);
  barrier.retire();
  expect(retire).toHaveBeenCalledOnce();
  resolve({ status: 'unknown', error: new Error('partial application') });
  expect((await ticket.result).status).toBe('unknown');
  expect(scope.enqueueIntent('replay').accepted).toBe(false);
});
