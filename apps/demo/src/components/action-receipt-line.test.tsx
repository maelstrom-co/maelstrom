// @vitest-environment happy-dom

import type { RequestOutcome, RequestOutcomeView } from '@maelstrom-co/client';
import type { ActionResult } from '@maelstrom-co/react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const latest = vi.hoisted(() => ({
  outcomes: {} as Readonly<Record<string, RequestOutcome>>,
  listeners: new Set<() => void>(),
}));

vi.mock('../lib/maelstrom', () => ({
  m: {
    useRequestOutcomes: () =>
      useSyncExternalStore(
        (listener) => {
          latest.listeners.add(listener);
          return () => latest.listeners.delete(listener);
        },
        () => latest.outcomes,
      ),
  },
}));

const {
  __resetClickReceiptsForTests,
  markClick,
  orderSettledRequests,
  withClickReceipts,
} = await import('../lib/click-receipt');
const { failureResult, receiptResult } = await import('../lib/request-receipt');
const { ActionReceiptLine } = await import('./action-receipt-line');

beforeEach(() => {
  setLatest(undefined);
  __resetClickReceiptsForTests();
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

  it("shows an earlier request's receipt when it settles while a later request is still queued", () => {
    render(<ActionReceiptLine />);
    const band = screen.getByTestId('action-receipt-line');
    act(() => {
      setLatest(outcome('ticket-1', 'processing', []));
      setLatest(outcome('ticket-2', 'queued', []));
    });
    expect(band.textContent).toBe('');
    act(() => {
      setLatest(outcome('ticket-1', 'applied', [ran('addTask', 'Added "A"')]));
    });
    expect(band.textContent).toBe('✓ Added "A"');
    act(() => {
      setLatest(outcome('ticket-3', 'not_submitted', []));
    });
    expect(band.textContent).toBe('✓ Added "A"');
    act(() => {
      setLatest(outcome('ticket-2', 'applied', [ran('addTask', 'Added "B"')]));
    });
    expect(band.textContent).toBe('✓ Added "B"');
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

  it('shows a direct click newer than the latest request, and the next request after it', async () => {
    render(<ActionReceiptLine />);
    act(() => {
      setLatest(outcome('ticket-1', 'applied', [ran('addTask', 'Added "A"')]));
    });
    await act(() =>
      click(
        'tasks',
        'checkTask',
        receiptResult('Checked task "Ship this sprint"'),
      ),
    );
    const band = screen.getByTestId('action-receipt-line');
    expect(band.textContent).toBe('✓ Checked task "Ship this sprint"');
    act(() => {
      setLatest(outcome('ticket-2', 'applied', [ran('addTask', 'Added "B"')]));
    });
    expect(band.textContent).toBe('✓ Added "B"');
  });

  it('keeps a newer direct click over the request after a remount', async () => {
    const first = render(<ActionReceiptLine />);
    act(() => {
      setLatest(outcome('ticket-1', 'applied', [ran('addTask', 'Added "A"')]));
    });
    await act(() =>
      click(
        'tasks',
        'checkTask',
        receiptResult('Checked task "Ship this sprint"'),
      ),
    );
    first.unmount();
    render(<ActionReceiptLine />);
    expect(screen.getByTestId('action-receipt-line').textContent).toBe(
      '✓ Checked task "Ship this sprint"',
    );
  });

  it('orders a request by when it settled, not by when the line first rendered it', async () => {
    const stop = orderSettledRequests(outcomeStore());
    setLatest(outcome('ticket-1', 'applied', [ran('addTask', 'Added "A"')]));
    await click(
      'tasks',
      'checkTask',
      receiptResult('Checked task "Ship this sprint"'),
    );
    render(<ActionReceiptLine />);
    const band = screen.getByTestId('action-receipt-line');
    expect(band.textContent).toBe('✓ Checked task "Ship this sprint"');
    act(() => {
      setLatest(outcome('ticket-2', 'applied', [ran('addTask', 'Added "B"')]));
    });
    expect(band.textContent).toBe('✓ Added "B"');
    stop();
  });

  it('marks a failed direct click with the problem tone', async () => {
    render(<ActionReceiptLine />);
    await act(() =>
      click(
        'journal',
        'editEntry',
        failureResult('Couldn\'t find journal entry "Gym log"', 'x'),
      ),
    );
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

async function click(
  vesselId: string,
  action: string,
  result: ActionResult,
): Promise<void> {
  markClick({ vesselId, action });
  await withClickReceipts(vesselId, { [action]: async () => result })[
    action
  ]?.();
}

function outcomeStore(): RequestOutcomeView['store'] {
  return {
    get state() {
      return { outcomes: latest.outcomes, latestId: null };
    },
    subscribe: (listener: () => void) => {
      latest.listeners.add(listener);
      return { unsubscribe: () => latest.listeners.delete(listener) };
    },
  } as unknown as RequestOutcomeView['store'];
}

function setLatest(next: RequestOutcome | undefined): void {
  latest.outcomes = next ? { ...latest.outcomes, [next.id]: next } : {};
  for (const listener of latest.listeners) listener();
}

function outcome(
  id: string,
  status: RequestOutcome['status'],
  actions: RequestOutcome['actions'],
): RequestOutcome {
  return { id, intent: id, status, actions };
}

function ran(action: string, value: string): RequestOutcome['actions'][number] {
  return {
    instanceId: 'tasks-1',
    action,
    status: 'ran',
    value,
  } as unknown as RequestOutcome['actions'][number];
}
