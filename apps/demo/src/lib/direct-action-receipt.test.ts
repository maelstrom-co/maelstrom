import { isErr, isOk } from '@maelstrom-co/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetDirectActionReceiptForTests,
  failureResult,
  getDirectReceipt,
  markDirectAction,
  receiptResult,
} from './direct-action-receipt';

const CHECK = { vesselId: 'tasks', action: 'checkTask' } as const;

beforeEach(() => {
  __resetDirectActionReceiptForTests();
});

describe('direct action receipts', () => {
  it('returns the receipt text as the success value', () => {
    const result = receiptResult('Added "A"', CHECK);
    expect(isOk(result) && result.value).toBe('Added "A"');
  });

  it('puts the receipt reason on the first line of a failure', () => {
    const result = failureResult('Couldn\'t find task "gym"', CHECK, 'Use T-1');
    expect(isErr(result) && result.error.message).toBe(
      'Couldn\'t find task "gym"\nUse T-1',
    );
    const bare = failureResult("Couldn't x", CHECK);
    expect(isErr(bare) && bare.error.message).toBe("Couldn't x");
  });

  it('publishes a receipt only for a marked direct click', () => {
    receiptResult('Checked task "Ship this sprint"', CHECK);
    expect(getDirectReceipt()).toBeNull();

    markDirectAction(CHECK);
    receiptResult('Checked task "Ship this sprint"', CHECK);
    expect(getDirectReceipt()?.part).toEqual({
      tone: 'success',
      text: '✓ Checked task "Ship this sprint"',
    });
  });

  it('uses a direct mark once and orders newer clicks after older ones', () => {
    markDirectAction(CHECK);
    receiptResult('Checked task "A"', CHECK);
    const first = getDirectReceipt();
    receiptResult('Checked task "B"', CHECK);
    expect(getDirectReceipt()).toBe(first);

    markDirectAction(CHECK);
    failureResult('Couldn\'t find task "gym"', CHECK);
    expect(getDirectReceipt()?.part).toEqual({
      tone: 'problem',
      text: '✗ Couldn\'t find task "gym"',
    });
    expect(getDirectReceipt()!.order).toBeGreaterThan(first!.order);
  });

  it('lets a direct mark expire', () => {
    vi.useFakeTimers();
    try {
      markDirectAction(CHECK);
      vi.advanceTimersByTime(10_000);
      receiptResult('Checked task "Ship this sprint"', CHECK);
      expect(getDirectReceipt()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('matches the mark to the same Vessel and Action', () => {
    markDirectAction({ vesselId: 'journal', action: 'checkTask' });
    receiptResult('Checked task "Ship this sprint"', CHECK);
    expect(getDirectReceipt()).toBeNull();
  });
});
