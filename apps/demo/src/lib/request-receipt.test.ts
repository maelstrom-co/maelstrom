import { isErr, isOk } from '@maelstrom-co/protocol';
import { describe, expect, it } from 'vitest';

import {
  actionReceiptPart,
  failureResult,
  readActionReceipt,
  receiptResult,
  resultReceiptPart,
} from './request-receipt';

describe('readActionReceipt', () => {
  it('reads a text value as the receipt of an Action that ran', () => {
    expect(readActionReceipt({ status: 'ran', value: 'Added "A"' })).toEqual({
      kind: 'done',
      text: 'Added "A"',
    });
  });

  it('keeps an Action that ran without a text value quiet', () => {
    for (const value of [undefined, '', 3, { added: 'A' }, ['A'], null])
      expect(readActionReceipt({ status: 'ran', value })).toEqual({
        kind: 'quiet',
      });
  });

  it('keeps a pending Action quiet until it settles', () => {
    expect(readActionReceipt({ status: 'pending' })).toEqual({
      kind: 'quiet',
    });
  });

  it('reads skipped and unknown Actions as not confirmed', () => {
    expect(readActionReceipt({ status: 'skipped' })).toEqual({
      kind: 'unconfirmed',
    });
    expect(readActionReceipt({ status: 'unknown' })).toEqual({
      kind: 'unconfirmed',
    });
  });

  it('shows only the first line of a failure reason that starts with "Couldn\'t"', () => {
    expect(
      readActionReceipt({
        status: 'failed',
        reason: 'Couldn\'t find task "gym"\nNo task matches "gym".\nUse T-1.',
      }),
    ).toEqual({ kind: 'failed', text: 'Couldn\'t find task "gym"' });
  });

  it('gives a failure without a "Couldn\'t" first line no receipt text', () => {
    for (const reason of [
      'handler timed out',
      '',
      'Guidance first\nCouldn\'t find task "gym"',
      'couldn\'t find task "gym"',
    ])
      expect(readActionReceipt({ status: 'failed', reason })).toEqual({
        kind: 'failed',
        text: null,
      });
  });
});

describe('actionReceiptPart', () => {
  it('marks a receipt with a check and a reported failure with a cross', () => {
    expect(actionReceiptPart({ status: 'ran', value: 'Added "A"' })).toEqual({
      tone: 'success',
      text: '✓ Added "A"',
    });
    expect(
      actionReceiptPart({ status: 'failed', reason: "Couldn't x\nguidance" }),
    ).toEqual({ tone: 'problem', text: "✗ Couldn't x" });
  });

  it('has no part for quiet, unconfirmed or unexplained Actions', () => {
    expect(actionReceiptPart({ status: 'ran', value: 3 })).toBeNull();
    expect(actionReceiptPart({ status: 'pending' })).toBeNull();
    expect(actionReceiptPart({ status: 'skipped' })).toBeNull();
    expect(actionReceiptPart({ status: 'unknown' })).toBeNull();
    expect(
      actionReceiptPart({ status: 'failed', reason: 'timed out' }),
    ).toBeNull();
  });
});

describe('handler results', () => {
  it('returns the receipt text as the success value', () => {
    const result = receiptResult('Added "A"');
    expect(isOk(result) && result.value).toBe('Added "A"');
    expect(resultReceiptPart(result)).toEqual({
      tone: 'success',
      text: '✓ Added "A"',
    });
  });

  it('puts the receipt reason on the first line of a failure and guidance after it', () => {
    const result = failureResult('Couldn\'t find task "gym"', 'Use T-1');
    expect(isErr(result) && result.error.message).toBe(
      'Couldn\'t find task "gym"\nUse T-1',
    );
    expect(resultReceiptPart(result)).toEqual({
      tone: 'problem',
      text: '✗ Couldn\'t find task "gym"',
    });
    const bare = failureResult("Couldn't x");
    expect(isErr(bare) && bare.error.message).toBe("Couldn't x");
  });
});
