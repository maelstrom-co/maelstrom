import { err, ok } from '@maelstrom-co/protocol';
import type { ActionResult } from '@maelstrom-co/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetClickReceiptsForTests,
  getClickReceipt,
  markClick,
  newerClickReceipt,
  nextReceiptOrder,
  withClickMarks,
  withClickReceipts,
} from './click-receipt';
import { failureResult, receiptResult } from './request-receipt';

const CHECK = { vesselId: 'tasks', action: 'checkTask' } as const;

beforeEach(() => {
  __resetClickReceiptsForTests();
});

describe('click receipts', () => {
  it('turns the text value of a clicked Action into its own receipt', async () => {
    await click(async () => receiptResult('Checked task "Ship this sprint"'));
    expect(getClickReceipt()?.part).toEqual({
      tone: 'success',
      text: '✓ Checked task "Ship this sprint"',
    });
  });

  it('shows a clicked failure by the first line of its reason', async () => {
    await click(async () =>
      failureResult('Couldn\'t find task "gym"', 'No task matches "gym".'),
    );
    expect(getClickReceipt()?.part).toEqual({
      tone: 'problem',
      text: '✗ Couldn\'t find task "gym"',
    });
  });

  it('shows no receipt for a clicked value that is not text', async () => {
    await click(async () => ok({ checked: true }));
    expect(getClickReceipt()?.part).toBeNull();
  });

  it('shows no receipt for a clicked failure without a "Couldn\'t" reason', async () => {
    await click(async () => err(new Error('handler timed out')));
    expect(getClickReceipt()?.part).toBeNull();
  });

  it('clears an earlier failure when a later click changes nothing', async () => {
    await click(async () => failureResult("Couldn't set the status"));
    const failure = getClickReceipt();
    expect(failure?.part?.tone).toBe('problem');

    await click(async () => ok(undefined));
    expect(getClickReceipt()?.part).toBeNull();
    expect(getClickReceipt()!.order).toBeGreaterThan(failure!.order);
  });

  it('publishes nothing for a handler run nobody clicked', async () => {
    const handlers = withClickReceipts('tasks', {
      checkTask: async () => receiptResult('Checked task "A"'),
    });
    await handlers.checkTask();
    expect(getClickReceipt()).toBeNull();
  });

  it('uses a mark once and orders newer clicks after older ones', async () => {
    const handlers = withClickReceipts('tasks', {
      checkTask: async (title: string) => receiptResult(`Checked "${title}"`),
    });
    markClick(CHECK);
    await handlers.checkTask('A');
    const first = getClickReceipt();
    await handlers.checkTask('B');
    expect(getClickReceipt()).toBe(first);

    markClick(CHECK);
    await handlers.checkTask('C');
    expect(getClickReceipt()?.part?.text).toBe('✓ Checked "C"');
    expect(getClickReceipt()!.order).toBeGreaterThan(first!.order);
  });

  it('matches the mark to the same Vessel and Action', async () => {
    const handlers = withClickReceipts('tasks', {
      checkTask: async () => receiptResult('Checked task "A"'),
    });
    markClick({ vesselId: 'journal', action: 'checkTask' });
    markClick({ vesselId: 'tasks', action: 'uncheckTask' });
    await handlers.checkTask();
    expect(getClickReceipt()).toBeNull();
  });

  it('lets a mark expire before its handler starts', async () => {
    vi.useFakeTimers();
    try {
      const handlers = withClickReceipts('tasks', {
        checkTask: async () => receiptResult('Checked task "A"'),
      });
      markClick(CHECK);
      vi.advanceTimersByTime(10_000);
      await handlers.checkTask();
      expect(getClickReceipt()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes a clicked receipt when its handler outlasts the mark lifetime', async () => {
    vi.useFakeTimers();
    try {
      let finish: (result: ActionResult) => void = () => {};
      const handlers = withClickReceipts('tasks', {
        checkTask: () =>
          new Promise<ActionResult>((resolve) => {
            finish = resolve;
          }),
      });
      withClickMarks('tasks', (name: string) => {
        void handlers[name as 'checkTask']();
      })('checkTask');
      await vi.advanceTimersByTimeAsync(6_000);
      finish(receiptResult('Checked task "A"'));
      await vi.advanceTimersByTimeAsync(0);
      expect(getClickReceipt()?.part?.text).toBe('✓ Checked task "A"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the result with the page reader when one is given', async () => {
    const handlers = withClickReceipts(
      'tasks',
      { checkTask: async () => err(new Error('timed out')) },
      (action) => ({ tone: 'problem', text: `✗ Couldn't run ${action}` }),
    );
    markClick(CHECK);
    await handlers.checkTask();
    expect(getClickReceipt()?.part?.text).toBe("✗ Couldn't run checkTask");
  });
});

describe('newerClickReceipt', () => {
  it('shows a click newer than the request and hides one older than it', async () => {
    const requestBefore = nextReceiptOrder();
    await click(async () => receiptResult('Checked task "A"'));
    const clicked = getClickReceipt();
    const requestAfter = nextReceiptOrder();

    expect(newerClickReceipt(clicked, requestBefore)).toBe(clicked);
    expect(newerClickReceipt(clicked, requestAfter)).toBeNull();
  });

  it('shows a click when no request has a receipt yet', async () => {
    await click(async () => receiptResult('Checked task "A"'));
    const clicked = getClickReceipt();
    expect(newerClickReceipt(clicked, undefined)).toBe(clicked);
    expect(newerClickReceipt(null, undefined)).toBeNull();
  });
});

async function click(handler: () => Promise<ActionResult>): Promise<void> {
  const handlers = withClickReceipts('tasks', { checkTask: handler });
  let run: Promise<unknown> = Promise.resolve();
  withClickMarks('tasks', (name: string) => {
    run = handlers[name as 'checkTask']();
  })('checkTask');
  await run;
}
