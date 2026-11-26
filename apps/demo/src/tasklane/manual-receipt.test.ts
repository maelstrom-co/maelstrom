import { err, ok } from '@maelstrom-co/protocol';
import type { ActionResult } from '@maelstrom-co/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetManualReceiptForTests,
  getManualReceipt,
  withManualReceipt,
  withManualReceipts,
} from './manual-receipt';

beforeEach(() => {
  __resetManualReceiptForTests();
});

describe('manual receipts', () => {
  it('turns a clicked Action note into its own receipt', async () => {
    const handlers = withManualReceipts({
      assignTask: async () => ok('Reassigned "Write demo copy" to Alex'),
    });
    const execute = withManualReceipt((name: string) => {
      void handlers[name as 'assignTask']();
    });

    execute('assignTask');
    await vi.waitFor(() =>
      expect(getManualReceipt()?.line).toEqual({
        text: '✓ Reassigned "Write demo copy" to Alex',
        tone: 'success',
      }),
    );
  });

  it('shows a clicked failure by its reason for the person', async () => {
    const handlers = withManualReceipts({
      removeTask: async () =>
        err(new Error('Couldn\'t find a task matching "Ghost"\nUse TL-1.')),
    });
    withManualReceipt((name: string) => {
      void handlers[name as 'removeTask']();
    })('removeTask');
    await vi.waitFor(() =>
      expect(getManualReceipt()?.line).toEqual({
        text: '✗ Couldn\'t find a task matching "Ghost"',
        tone: 'problem',
      }),
    );
  });

  it('clears an earlier failure line when a click changes nothing', async () => {
    let fail = true;
    const handlers = withManualReceipts({
      setStatus: async () =>
        fail ? err(new Error("Couldn't set the status")) : ok(undefined),
    });
    const execute = withManualReceipt((name: string) => {
      void handlers[name as 'setStatus']();
    });
    execute('setStatus');
    await vi.waitFor(() =>
      expect(getManualReceipt()?.line?.tone).toBe('problem'),
    );
    fail = false;
    execute('setStatus');
    await vi.waitFor(() => expect(getManualReceipt()?.sequence).toBe(2));
    expect(getManualReceipt()?.line).toBeNull();
  });

  it('publishes a clicked receipt when its handler outlasts the mark lifetime', async () => {
    vi.useFakeTimers();
    try {
      let finish: (result: ActionResult) => void = () => {};
      const handlers = withManualReceipts({
        assignTask: () =>
          new Promise<ActionResult>((resolve) => {
            finish = resolve;
          }),
      });
      withManualReceipt((name: string) => {
        void handlers[name as 'assignTask']();
      })('assignTask');
      await vi.advanceTimersByTimeAsync(6_000);
      finish(ok('Reassigned "A" to Alex'));
      await vi.advanceTimersByTimeAsync(0);
      expect(getManualReceipt()?.line).toEqual({
        text: '✓ Reassigned "A" to Alex',
        tone: 'success',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes nothing for a handler run nobody clicked', async () => {
    const handlers = withManualReceipts({
      createTask: async () => ok('Created "A"'),
    });
    await handlers.createTask();
    expect(getManualReceipt()).toBeNull();
  });
});
