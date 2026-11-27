// @vitest-environment happy-dom

import type {
  RequestOutcome,
  RequestOutcomesState,
  RequestOutcomeView,
} from '@maelstrom-co/client';
import { ok } from '@maelstrom-co/protocol';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requests = vi.hoisted(() => ({
  state: { outcomes: {}, latestId: null } as RequestOutcomesState,
  listeners: new Set<() => void>(),
}));

let store = requestStore();

function useRequests<Selected>(
  select: (state: RequestOutcomesState) => Selected,
): Selected {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener).unsubscribe,
    () => select(requests.state),
  );
}

const { requestReceiptSequence } = await import('./request-references');

vi.mock('./maelstrom', () => ({
  tasklaneM: {
    useRequestReferences: () => undefined,
    useReceiptRequestId: () => useRequests((state) => state.latestId),
    useRequestOutcome: (id: string | null) =>
      useRequests((state) => (id === null ? undefined : state.outcomes[id])),
    useRequestReceiptSequence: () =>
      useRequests(() => requestReceiptSequence(store)),
  },
}));

const { __resetManualReceiptForTests, withManualReceipt, withManualReceipts } =
  await import('./manual-receipt');
const { TasklaneReceiptLine } = await import('./tasklane-receipt-line');

beforeEach(() => {
  __resetManualReceiptForTests();
  requests.state = { outcomes: {}, latestId: null };
  store = requestStore();
  // The band is absent while requests settle, as an Orchestrator's own watch would see them.
  requests.listeners.clear();
  requests.listeners.add(() => {
    requestReceiptSequence(store);
  });
});

afterEach(cleanup);

describe('TasklaneReceiptLine', () => {
  it('shows a request that settled after the stored click when the band mounts', async () => {
    await click('Reassigned "Write demo copy" to Alex');
    settle('ticket-1', 'Created "Only one"');

    render(<TasklaneReceiptLine />);
    expect(screen.getByTestId('tasklane-receipt').textContent).toBe(
      '✓ Created "Only one"',
    );
  });

  it('shows a click made after the request settled when the band mounts', async () => {
    settle('ticket-1', 'Created "Only one"');
    await click('Reassigned "Write demo copy" to Alex');

    render(<TasklaneReceiptLine />);
    expect(screen.getByTestId('tasklane-receipt').textContent).toBe(
      '✓ Reassigned "Write demo copy" to Alex',
    );
  });

  it('hands the band to whichever changed last while mounted', async () => {
    render(<TasklaneReceiptLine />);
    const band = screen.getByTestId('tasklane-receipt');
    act(() => settle('ticket-1', 'Created "Only one"'));
    expect(band.textContent).toBe('✓ Created "Only one"');
    await act(() => click('Reassigned "Write demo copy" to Alex'));
    expect(band.textContent).toBe('✓ Reassigned "Write demo copy" to Alex');
    act(() => settle('ticket-2', 'Created "Another"'));
    expect(band.textContent).toBe('✓ Created "Another"');
  });
});

function requestStore(): RequestOutcomeView['store'] {
  return {
    get state() {
      return requests.state;
    },
    subscribe: (listener: () => void) => {
      requests.listeners.add(listener);
      return { unsubscribe: () => requests.listeners.delete(listener) };
    },
  } as unknown as RequestOutcomeView['store'];
}

async function click(receipt: string): Promise<void> {
  const handlers = withManualReceipts({ assignTask: async () => ok(receipt) });
  let run: Promise<unknown> = Promise.resolve();
  withManualReceipt((name: string) => {
    run = handlers[name as 'assignTask']();
  })('assignTask');
  await run;
}

function settle(id: string, receipt: string): void {
  const outcome: RequestOutcome = {
    id,
    intent: id,
    status: 'applied',
    actions: [
      {
        instanceId: 'tasks-1',
        action: 'createTask',
        status: 'ran',
        value: receipt,
      },
    ] as unknown as RequestOutcome['actions'],
  };
  requests.state = {
    outcomes: { ...requests.state.outcomes, [id]: outcome },
    latestId: id,
  };
  for (const listener of requests.listeners) listener();
}
