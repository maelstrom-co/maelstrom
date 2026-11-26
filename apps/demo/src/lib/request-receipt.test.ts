import type { RequestOutcome } from '@maelstrom-co/client';
import { describe, expect, it } from 'vitest';

import {
  hasReportedFailure,
  joinReceiptParts,
  requestProblemSummary,
  requestReceiptParts,
} from './request-receipt';

type ActionOutcome = RequestOutcome['actions'][number];

describe('requestReceiptParts', () => {
  it('renders notes as check marks joined with a middle dot', () => {
    expect(
      text([
        ran('createEntry', 'Created journal entry "Design review prep"'),
        ran('writeContent', 'Wrote to "Design review prep"'),
      ]),
    ).toBe(
      '✓ Created journal entry "Design review prep" · ✓ Wrote to "Design review prep"',
    );
  });

  it('renders failures with a cross and the first line of the reason', () => {
    expect(
      text([failed('checkTask', 'Couldn\'t find task "gym"\nNo task matches')]),
    ).toBe('✗ Couldn\'t find task "gym"');
  });

  it('renders an already-applied outcome as confirmed without claiming a change', () => {
    expect(
      text([ran('checkTask', '"Setup CI pipeline" was already done')]),
    ).toBe('✓ "Setup CI pipeline" was already done');
  });

  it('marks a skipped or unknown data Action as not confirmed', () => {
    expect(
      text([
        ran('addTask', 'Added "Prepare design review"'),
        { ...target('checkTask'), status: 'skipped', reason: 'missing' },
        { ...target('removeTask'), status: 'unknown' },
      ] as ActionOutcome[]),
    ).toBe(
      '✓ Added "Prepare design review" · ? Not confirmed: checkTask · ? Not confirmed: removeTask',
    );
  });

  it('marks a data Action that failed without a reason of its own as not confirmed', () => {
    expect(text([failed('addTask', 'handler timed out')])).toBe(
      '? Not confirmed: addTask',
    );
  });

  it('names a repeated unconfirmed Action once', () => {
    expect(
      text([
        ran('addTask', 'Added "A"'),
        { ...target('addTask'), status: 'unknown' },
        { ...target('addTask'), status: 'unknown' },
      ] as ActionOutcome[]),
    ).toBe('✓ Added "A" · ? Not confirmed: addTask');
  });

  it('ignores Actions that are not data Actions or have no note', () => {
    expect(
      text([
        { ...target('openEntry'), status: 'unknown' },
        { ...target('setView'), status: 'ran' },
      ] as ActionOutcome[]),
    ).toBe('');
  });

  it('says nothing yet for pending Actions', () => {
    expect(
      text([{ ...target('addTask'), status: 'pending' }] as ActionOutcome[]),
    ).toBe('');
  });

  it('produces no parts for a layout-only request', () => {
    expect(requestReceiptParts({ actions: [] })).toEqual([]);
  });

  it('tones confirmed parts as success and the rest as problems', () => {
    expect(
      requestReceiptParts({
        actions: [
          ran('addTask', 'Added "A"'),
          failed('checkTask', 'Couldn\'t find task "gym"'),
          ran('checkTask', '"B" was already done'),
        ],
      }).map((part) => part.tone),
    ).toEqual(['success', 'problem', 'success']);
  });
});

describe('requestProblemSummary', () => {
  it('summarises only the problems of a request for the intent feedback', () => {
    expect(
      requestProblemSummary({
        actions: [
          ran('addTask', 'Added "A"'),
          failed('checkTask', 'Couldn\'t find task "gym"'),
          { ...target('removeTask'), status: 'skipped', reason: 'missing' },
        ] as ActionOutcome[],
      }),
    ).toBe('✗ Couldn\'t find task "gym" · ? Not confirmed: removeTask');
  });

  it('has no problem summary for a clean request', () => {
    expect(
      requestProblemSummary({ actions: [ran('addTask', 'Added "A"')] }),
    ).toBeNull();
  });
});

describe('hasReportedFailure', () => {
  it('is true only for a failure the handler reported', () => {
    expect(
      hasReportedFailure({ actions: [failed('checkTask', "Couldn't x")] }),
    ).toBe(true);
    expect(
      hasReportedFailure({ actions: [failed('checkTask', 'timed out')] }),
    ).toBe(false);
    expect(
      hasReportedFailure({
        actions: [
          { ...target('addTask'), status: 'unknown' },
        ] as ActionOutcome[],
      }),
    ).toBe(false);
  });
});

function target(action: string) {
  return { instanceId: 'tasks-1', action } as unknown as Pick<
    ActionOutcome,
    'instanceId' | 'action'
  >;
}

function ran(action: string, note: string): ActionOutcome {
  return { ...target(action), status: 'ran', note } as ActionOutcome;
}

function failed(action: string, reason: string): ActionOutcome {
  return { ...target(action), status: 'failed', reason } as ActionOutcome;
}

function text(actions: readonly ActionOutcome[]): string {
  return joinReceiptParts(requestReceiptParts({ actions }));
}
