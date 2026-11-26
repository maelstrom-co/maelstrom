// @vitest-environment happy-dom

import type { RequestOutcome } from '@maelstrom-co/client';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const latest = vi.hoisted(() => ({
  outcome: undefined as RequestOutcome | undefined,
  listeners: new Set<() => void>(),
}));

vi.mock('../lib/maelstrom', () => ({
  m: {
    useLatestRequestOutcome: () =>
      useSyncExternalStore(
        (listener) => {
          latest.listeners.add(listener);
          return () => latest.listeners.delete(listener);
        },
        () => latest.outcome,
      ),
  },
}));

const {
  __resetDirectActionReceiptForTests,
  markDirectAction,
  failureResult,
  noteResult,
} = await import('../lib/direct-action-receipt');
const { ActionReceiptLine } = await import('./action-receipt-line');

beforeEach(() => {
  setLatest(undefined);
  __resetDirectActionReceiptForTests();
});

afterEach(cleanup);

describe('ActionReceiptLine', () => {
  it('always renders the fixed one-line band, empty when nothing changed', () => {
    render(<ActionReceiptLine />);
    const band = screen.getByTestId('action-receipt-line');
    expect(band.classList.contains('action-receipt-line')).toBe(true);
    expect(band.classList.contains('h-6')).toBe(true);
    expect(band.textContent).toBe('');
    expect(band.getAttribute('title')).toBeNull();
  });

  it('is a polite live region', () => {
    render(<ActionReceiptLine />);
    expect(
      screen.getByTestId('action-receipt-line').getAttribute('aria-live'),
    ).toBe('polite');
  });

  it('shows the latest receipt with the full text as a tooltip', () => {
    render(<ActionReceiptLine />);
    act(() => {
      setLatest(
        outcome('ticket-1', 'applied', [
          ran('createEntry', 'Created journal entry "Design review prep"'),
          ran('writeContent', 'Wrote to "Design review prep"'),
        ]),
      );
    });
    const band = screen.getByTestId('action-receipt-line');
    const text =
      '✓ Created journal entry "Design review prep" · ✓ Wrote to "Design review prep"';
    expect(band.textContent).toBe(text);
    expect(band.getAttribute('title')).toBe(text);
  });

  it('keeps the previous receipt until the next request settles', () => {
    render(<ActionReceiptLine />);
    act(() => {
      setLatest(outcome('ticket-1', 'applied', [ran('addTask', 'Added "A"')]));
    });
    act(() => {
      setLatest(
        outcome('ticket-2', 'processing', [ran('addTask', 'Added "B"')]),
      );
    });
    expect(screen.getByTestId('action-receipt-line').textContent).toBe(
      '✓ Added "A"',
    );
    act(() => {
      setLatest(outcome('ticket-2', 'applied', [ran('addTask', 'Added "B"')]));
    });
    expect(screen.getByTestId('action-receipt-line').textContent).toBe(
      '✓ Added "B"',
    );
  });

  it('marks failures with the problem tone', () => {
    render(<ActionReceiptLine />);
    act(() => {
      setLatest(
        outcome('ticket-1', 'unknown', [
          {
            instanceId: 'tasks-1',
            action: 'checkTask',
            status: 'failed',
            reason: 'Couldn\'t find task "gym"\nNo task matches "gym".',
          },
        ] as unknown as RequestOutcome['actions']),
      );
    });
    const problem = screen.getByText('✗ Couldn\'t find task "gym"');
    expect(problem.getAttribute('data-tone')).toBe('problem');
  });

  it('shows a direct click newer than the latest request, and the next request after it', () => {
    render(<ActionReceiptLine />);
    act(() => {
      setLatest(outcome('ticket-1', 'applied', [ran('addTask', 'Added "A"')]));
    });
    act(() => {
      const source = { vesselId: 'tasks', action: 'checkTask' };
      markDirectAction(source);
      noteResult('Checked task "Ship this sprint"', source);
    });
    const band = screen.getByTestId('action-receipt-line');
    expect(band.textContent).toBe('✓ Checked task "Ship this sprint"');
    act(() => {
      setLatest(outcome('ticket-2', 'applied', [ran('addTask', 'Added "B"')]));
    });
    expect(band.textContent).toBe('✓ Added "B"');
  });

  it('marks a failed direct click with the problem tone', () => {
    render(<ActionReceiptLine />);
    act(() => {
      const source = { vesselId: 'journal', action: 'editEntry' };
      markDirectAction(source);
      failureResult('Couldn\'t find journal entry "Gym log"', source, 'x');
    });
    const problem = screen.getByText(
      '✗ Couldn\'t find journal entry "Gym log"',
    );
    expect(problem.getAttribute('data-tone')).toBe('problem');
  });

  it('keeps the band mounted and empties it after a layout-only request', () => {
    render(<ActionReceiptLine />);
    act(() => {
      setLatest(outcome('ticket-1', 'applied', [ran('addTask', 'Added "A"')]));
    });
    expect(screen.getByTestId('action-receipt-line').textContent).toBe(
      '✓ Added "A"',
    );
    act(() => {
      setLatest(outcome('ticket-2', 'applied', []));
    });
    const band = screen.getByTestId('action-receipt-line');
    expect(band.textContent).toBe('');
    expect(band.classList.contains('h-6')).toBe(true);
  });
});

function setLatest(next: RequestOutcome | undefined): void {
  latest.outcome = next;
  for (const listener of latest.listeners) listener();
}

function outcome(
  id: string,
  status: RequestOutcome['status'],
  actions: RequestOutcome['actions'],
): RequestOutcome {
  return { id, intent: id, status, actions };
}

function ran(action: string, note: string): RequestOutcome['actions'][number] {
  return {
    instanceId: 'tasks-1',
    action,
    status: 'ran',
    note,
  } as unknown as RequestOutcome['actions'][number];
}
