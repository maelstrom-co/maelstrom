import { afterEach, expect, it } from 'bun:test';
import type {
  IntentSnapshot,
  IntentSubmission,
  Orchestrator,
} from '@maelstrom-co/client';
import type {
  ChartRequestMessage,
  MaelstromResponse,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { act, cleanup, render } from '@testing-library/react';
import { memo, useState } from 'react';
import { createMockConnector } from './__tests__/mock-connector.js';
import { createMaelstrom } from './create-maelstrom.js';
import type { MaelstromState } from './maelstrom-state-types.js';
import { useIntentSubmission } from './use-intent-submission.js';

afterEach(cleanup);

function slowConnector() {
  const sent: ChartRequestMessage[] = [];
  const pending: Array<{
    resolve: (value: MaelstromResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  const connector = createMockConnector({
    process: (request) => {
      sent.push(request);
      return new Promise((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    },
  });
  const finish = (index: number) =>
    pending[index].resolve({
      type: 'maelstrom_response',
      requestId: sent[index].id,
      layout: { type: 'grid', positions: [] },
      executionPlan: [],
      rationale: '',
      userMessage: 'Done',
    });
  return { connector, sent, pending, finish };
}

it('observes shared FIFO through a 3s resize, interleaved voice, and multiple typed submissions', async () => {
  const clock = FakeTimers.install({
    toFake: ['Date', 'setTimeout', 'clearTimeout'],
  });
  try {
    const { connector, sent, finish } = slowConnector();
    const m = createMaelstrom({ vessels: [] }).with((context) => ({
      useContext: context.useMaelstromContext,
    }));
    let state!: MaelstromState;
    let client!: Orchestrator;
    const observed: { snapshot: IntentSnapshot | null } = { snapshot: null };
    let observe!: (ticket: IntentSubmission | null) => void;
    function Probe() {
      state = m.useMaelstrom();
      client = m.useContext().orchestrator;
      const [ticket, setTicket] = useState<IntentSubmission | null>(null);
      observe = setTicket;
      observed.snapshot = useIntentSubmission(ticket);
      return null;
    }
    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Probe />
        </m.Provider>,
      );
    });
    expect(observed.snapshot).toBeNull();
    await act(async () => {
      client.chartManager.setDimensions({ columns: 10, rows: 6 });
      await clock.tickAsync(350);
    });
    let first!: IntentSubmission;
    let second!: IntentSubmission;
    let voice!: IntentSubmission;
    await act(async () => {
      first = state.enqueueIntent('typed first');
      voice = client.createIntentScope().enqueueIntent('voice second');
      second = state.enqueueIntent('typed third');
      observe(first);
      await clock.tickAsync(3000);
    });
    expect(sent).toHaveLength(1);
    expect(observed.snapshot).toEqual({ status: 'queued', queuePosition: 1 });
    expect(state.intentScheduler.pendingCount).toBe(3);
    await act(async () => {
      finish(0);
    });
    expect(observed.snapshot?.status).toBe('processing');
    expect(sent[1].request.context.updateReasons.at(-1)).toEqual({
      type: 'user_intent',
      intent: 'typed first',
    });
    await act(async () => {
      finish(1);
    });
    expect(observed.snapshot?.status).toBe('applied');
    expect(state.lastResponse).toBeNull();
    expect(sent[2].request.context.updateReasons.at(-1)).toEqual({
      type: 'user_intent',
      intent: 'voice second',
    });
    await act(async () => {
      finish(2);
    });
    expect(sent[3].request.context.updateReasons.at(-1)).toEqual({
      type: 'user_intent',
      intent: 'typed third',
    });
    await act(async () => {
      finish(3);
    });
    expect((await first.result).status).toBe('applied');
    expect((await voice.result).status).toBe('applied');
    expect((await second.result).status).toBe('applied');
    expect(state.intentScheduler.pendingCount).toBe(0);
    cleanup();
  } finally {
    clock.uninstall();
  }
});

it('forwards factory policy, replaces it at Provider mount, and ignores later policy changes', async () => {
  const { connector } = slowConnector();
  const m = createMaelstrom({ vessels: [], intentQueue: { capacity: 2 } });
  let state!: MaelstromState;
  function Probe() {
    state = m.useMaelstrom();
    return null;
  }
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <m.Provider connector={connector}>
        <Probe />
      </m.Provider>,
    );
  });
  expect(state.intentScheduler.capacity).toBe(2);
  await act(async () => {
    view.rerender(
      <m.Provider connector={connector} intentQueue={{ capacity: 4 }}>
        <Probe />
      </m.Provider>,
    );
  });
  expect(state.intentScheduler.capacity).toBe(2);
  await act(async () => {
    view.rerender(
      <m.Provider key="new" connector={connector} intentQueue={{ capacity: 1 }}>
        <Probe />
      </m.Provider>,
    );
  });
  expect(state.intentScheduler.capacity).toBe(1);
  let active!: IntentSubmission;
  let waiting!: IntentSubmission;
  let full!: IntentSubmission;
  await act(async () => {
    active = state.enqueueIntent('active');
  });
  await act(async () => {
    waiting = state.enqueueIntent('waiting');
    full = state.enqueueIntent('full');
  });
  expect(full.accepted).toBe(false);
  expect(await full.result).toEqual({
    status: 'not_submitted',
    reason: 'queue_full',
  });
  await act(async () => {
    view.unmount();
  });
  expect((await active.result).status).toBe('unknown');
  expect(await waiting.result).toEqual({
    status: 'not_submitted',
    reason: 'disposed',
  });
});

it('keeps context stable for inline mount-only queue policy while other config remains dynamic', async () => {
  const { connector } = slowConnector();
  const m = createMaelstrom({ vessels: [] }).with((context) => ({
    useContext: context.useMaelstromContext,
  }));
  let context!: ReturnType<typeof m.useContext>;
  let renders = 0;
  const Probe = memo(() => {
    context = m.useContext();
    renders++;
    return null;
  });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <m.Provider connector={connector} intentQueue={{ capacity: 4 }}>
        <Probe />
      </m.Provider>,
    );
  });
  const mounted = context;
  const mountedRenders = renders;
  for (const capacity of [4, 8]) {
    await act(async () => {
      view.rerender(
        <m.Provider connector={connector} intentQueue={{ capacity }}>
          <Probe />
        </m.Provider>,
      );
    });
    expect(context).toBe(mounted);
    expect(renders).toBe(mountedRenders);
    expect(context.orchestrator.intentScheduler.store.state.capacity).toBe(4);
  }
  await act(async () => {
    view.rerender(
      <m.Provider
        connector={connector}
        intentQueue={{ capacity: 8 }}
        cellSizePx={90}
        tilingPaddingPx={12}
        debug
        motion={{ disabled: true }}
      >
        <Probe />
      </m.Provider>,
    );
  });
  expect(context).not.toBe(mounted);
  expect(context.orchestrator).toBe(mounted.orchestrator);
  expect(context.config).toMatchObject({
    intentQueue: { capacity: 4 },
    cellSizePx: 90,
    tilingPaddingPx: 12,
    debug: true,
    motion: { disabled: true },
  });
  expect(renders).toBeGreaterThan(mountedRenders);
});

it('observes immediate refusal, error identity, and a new ticket without stale completion', async () => {
  const { connector, pending } = slowConnector();
  const m = createMaelstrom({ vessels: [], intentQueue: { capacity: 1 } });
  let state!: MaelstromState;
  const observed: { snapshot: IntentSnapshot | null } = { snapshot: null };
  let observe!: (ticket: IntentSubmission | null) => void;
  function Probe() {
    state = m.useMaelstrom();
    const [ticket, setTicket] = useState<IntentSubmission | null>(null);
    observe = setTicket;
    observed.snapshot = useIntentSubmission(ticket);
    return null;
  }
  await act(async () => {
    render(
      <m.Provider connector={connector}>
        <Probe />
      </m.Provider>,
    );
  });
  let active!: IntentSubmission;
  await act(async () => {
    active = state.enqueueIntent('active');
  });
  await act(async () => {
    state.enqueueIntent('waiting');
    observe(state.enqueueIntent('full'));
  });
  expect(observed.snapshot).toEqual({
    status: 'not_submitted',
    reason: 'queue_full',
  });
  const error = new Error('transport failed');
  await act(async () => {
    pending[0].reject(error);
  });
  expect(await active.result).toEqual({ status: 'unknown', error });
  expect(observed.snapshot).toEqual({
    status: 'not_submitted',
    reason: 'queue_full',
  });
  await act(async () => {
    observe(active);
  });
  expect(observed.snapshot).toEqual({ status: 'unknown', error });
  expect(state.lastError).toBeNull();
});

it('forwards pending expiry and active deadlines without releasing an unresolved transport', async () => {
  const clock = FakeTimers.install({
    toFake: ['Date', 'setTimeout', 'clearTimeout'],
  });
  try {
    const { connector, sent } = slowConnector();
    const m = createMaelstrom({
      vessels: [],
      intentQueue: { maxWaitMs: 2000, activeTimeoutMs: 4000 },
    });
    let state!: MaelstromState;
    function Probe() {
      state = m.useMaelstrom();
      return null;
    }
    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Probe />
        </m.Provider>,
      );
    });
    let active!: IntentSubmission;
    let waiting!: IntentSubmission;
    await act(async () => {
      active = state.enqueueIntent('active');
      waiting = state.enqueueIntent('waiting');
      await clock.tickAsync(2000);
    });
    expect(await waiting.result).toEqual({
      status: 'not_submitted',
      reason: 'queue_expired',
    });
    await act(async () => {
      await clock.tickAsync(2000);
    });
    expect((await active.result).status).toBe('unknown');
    expect(sent).toHaveLength(1);
    expect(state.intentScheduler.phase).toBe('sending');
    cleanup();
  } finally {
    clock.uninstall();
  }
});
