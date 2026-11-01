// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentOperation } from '../lib/agui-contract';
import { handleAguiRequest } from '../server/agui-handler';
import { __resetJournalStoreForTests } from '../vessels/journal.store';
import { ExperimentalAgui } from './experimental-agui';

afterEach(async () => {
  await act(async () => cleanup());
  vi.unstubAllGlobals();
  __resetJournalStoreForTests();
});

async function setup(
  mode: 'fixture' | 'live' = 'fixture',
  holdStart?: (response: Response) => Promise<Response>,
) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: { width: 1200, height: 800 },
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  const operations: AgentOperation[] = [];
  const sessions: { sessionId: string; mode: string; apiKey?: string }[] = [];
  const deleted: string[] = [];
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (body?.forwardedProps) operations.push(body.forwardedProps);
    if (body?.mode) sessions.push(body);
    if (init.method === 'DELETE')
      deleted.push(String(new Headers(init.headers).get('Authorization')));
    if (body?.mode === 'live')
      return Response.json({ token: 'live-handshake-fixture' });
    const request = new Request(`${window.location.origin}${path}`, {
      ...init,
      headers: { ...init.headers, origin: window.location.origin },
    });
    // Happy DOM omits the browser-managed Origin header at this HTTP boundary.
    const headers = new Headers(request.headers);
    headers.set('origin', window.location.origin);
    Object.defineProperty(request, 'headers', { value: headers });
    const response = await handleAguiRequest(request);
    return body?.mode && holdStart ? holdStart(response) : response;
  });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <StrictMode>
        <ExperimentalAgui onExit={() => view.unmount()} />
      </StrictMode>,
    );
  });
  fireEvent.change(view.getByLabelText('Experimental planner'), {
    target: { value: mode },
  });
  if (mode === 'live')
    fireEvent.change(view.getByLabelText('Experimental OpenAI key'), {
      target: { value: 'test-only-not-a-provider-key' },
    });
  await act(async () => {
    fireEvent.click(
      view.getByRole('button', { name: 'Start experimental session' }),
    );
  });
  const run = view.getByRole('button', {
    name: 'Create and record generated ID',
  }) as HTMLButtonElement;
  return { view, run, operations, sessions, deleted };
}

it('completes the Journal journey once after StrictMode replays setup', async () => {
  const { view, run, operations, sessions, deleted } = await setup();
  await waitFor(() => expect(run.disabled).toBe(false));
  const title = 'StrictMode Journal journey';
  fireEvent.change(view.getByLabelText('Journal entry title'), {
    target: { value: title },
  });
  await act(async () => {
    fireEvent.click(run);
  });
  await waitFor(() =>
    expect(
      view.getByText('Complete · dependent write observed in the application'),
    ).toBeTruthy(),
  );
  const id = view
    .getByTestId('agui-observed-id')
    .textContent?.replace('Observed application ID: ', '');
  expect(id).toBeTruthy();
  expect(
    view.getByText(`Generated entry ID: ${id}`, { exact: true }),
  ).toBeTruthy();
  expect(view.getAllByRole('heading', { name: title })).toHaveLength(1);
  const actions = operations.flatMap((operation) =>
    operation.kind === 'ack' ? operation.ack.actions : [],
  );
  expect(actions.map((action) => action.action)).toEqual([
    'createEntry',
    'writeContent',
  ]);
  expect(sessions).toHaveLength(1);
  expect(deleted).toHaveLength(0);
  await act(async () => {
    fireEvent.click(
      view.getByRole('button', { name: 'Return to normal demo' }),
    );
  });
  await waitFor(() => expect(deleted).toHaveLength(1));
});

it('keeps the live handshake usable through replay and releases it on idle unmount', async () => {
  const { view, run, operations, sessions, deleted } = await setup('live');
  await waitFor(() => expect(run.disabled).toBe(false));
  expect(sessions).toEqual([
    {
      sessionId: expect.any(String),
      mode: 'live',
      apiKey: 'test-only-not-a-provider-key',
    },
  ]);
  expect(deleted).toHaveLength(0);
  expect(operations).toHaveLength(0);
  await act(async () => view.unmount());
  await waitFor(() => expect(deleted).toHaveLength(1));
});

it('deletes a late startup token after exit without reconnecting or running a goal', async () => {
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { view, run, operations, sessions, deleted } = await setup(
    'fixture',
    async (response) => {
      await responseGate;
      return response;
    },
  );
  try {
    expect(run.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(
        view.getByRole('button', { name: 'Return to normal demo' }),
      );
    });
    await act(async () => {
      release();
    });
    await waitFor(() => expect(deleted).toHaveLength(1));
    expect(sessions).toHaveLength(1);
    expect(operations).toHaveLength(0);
  } finally {
    release();
  }
});
