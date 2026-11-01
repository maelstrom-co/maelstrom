import { once } from 'node:events';
import { createServer } from 'node:http';

import { Orchestrator } from '@maelstrom-co/client';
import { err, InstanceId, ok, SessionId } from '@maelstrom-co/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleAguiRequest } from '../server/agui-handler';
import { getJournalSnapshot, journalActions } from '../vessels/journal.store';
import { journalVessel } from '../vessels/journal.vessel.def';
import { AguiConnector } from './agui-connector';
import type { AgentOperation } from './agui-contract';

type WireBody = { forwardedProps?: AgentOperation };

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type Options = {
  failAction?: boolean;
  skipRunner?: boolean;
  applicationAcknowledgmentTimeoutMs?: number;
  changeAck?: (body: WireBody) => void;
  dropAck?: boolean;
  onCreate?: (connector: AguiConnector, orchestrator: Orchestrator) => void;
  changeResponse?: (response: Response, body: WireBody) => Promise<Response>;
};
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const release of cleanup.splice(0)) await release();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function setup(options: Options = {}) {
  const requests: WireBody[] = [];
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const body: WireBody = init.body ? JSON.parse(String(init.body)) : {};
    options.changeAck?.(body);
    requests.push(body);
    if (
      options.dropAck &&
      body.forwardedProps?.kind === 'ack' &&
      body.forwardedProps.ack.actions.length
    )
      throw new Error('Connection lost after write');
    const response = await handleAguiRequest(
      new Request(`http://localhost${path}`, {
        ...init,
        body: init.body ? JSON.stringify(body) : undefined,
        headers: { ...init.headers, origin: 'http://localhost' },
      }),
    );
    return options.changeResponse
      ? options.changeResponse(response, body)
      : response;
  });
  const connector = new AguiConnector('fixture', null);
  const sessionId = SessionId(crypto.randomUUID());
  const orchestrator = new Orchestrator(connector, {
    sessionId,
    vessels: [journalVessel],
    layoutMode: 'tiling',
    readyTimeoutMs: 50,
    applicationAcknowledgmentTimeoutMs:
      options.applicationAcknowledgmentTimeoutMs,
  });
  cleanup.push(async () => {
    await orchestrator.dispose();
  });
  let creates = 0;
  orchestrator.commandProcessor.events.on('command_complete', ({ command }) => {
    if (options.skipRunner) return;
    if (
      command.kind !== 'set_layout' ||
      !orchestrator.commandProcessor.store.state.instances.has(
        InstanceId('agui-journal'),
      )
    )
      return;
    orchestrator.commandProcessor.registerRunner<typeof journalVessel>(
      InstanceId('agui-journal'),
      {
        openEntry: () => err(new Error('Unexpected fixture Action')),
        editEntry: () => err(new Error('Unexpected fixture Action')),
        backToList: () => err(new Error('Unexpected fixture Action')),
        createEntry: ({ title }) => {
          if (options.failAction)
            return err(new Error('Application refused create'));
          if (!connector.allowWrite('createEntry'))
            return err(new Error('Retired'));
          creates++;
          journalActions.createEntry(title);
          options.onCreate?.(connector, orchestrator);
          return ok(undefined);
        },
        writeContent: ({ text }) =>
          connector.allowWrite('writeContent') &&
          journalActions.writeContent(text)
            ? ok(undefined)
            : err(new Error('Stale selection')),
      },
    );
  });
  orchestrator.chartManager.setDimensions({ columns: 12, rows: 8 });
  await orchestrator.connect();
  return {
    connector,
    orchestrator,
    sessionId,
    requests,
    creates: () => creates,
  };
}

describe('experimental Journal session', () => {
  it('retires an automatic update at the client acknowledgment deadline and fences its late result', async () => {
    vi.useFakeTimers();
    const waiting = gate();
    const delivered = gate();
    const h = await setup({
      applicationAcknowledgmentTimeoutMs: 10,
      changeResponse: async (response, body) => {
        if (body.forwardedProps?.kind === 'ack') {
          waiting.resolve();
          await delivered.promise;
        }
        return response;
      },
    });
    h.orchestrator.chartManager.setDimensions({ columns: 13, rows: 8 });
    const update = h.orchestrator.flushUpdates();
    await waiting.promise;
    try {
      await vi.advanceTimersByTimeAsync(10);
      await update;
      expect(h.connector.state.phase).toBe('stopped');
    } finally {
      delivered.resolve();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(h.connector.state.phase).toBe('stopped');
    expect(h.connector.state.revision).toBe(0);
    expect(
      h.requests.filter((r) => r.forwardedProps?.kind === 'plan'),
    ).toHaveLength(1);
  });

  it('bounds startup through body consumption so retirement cannot wait forever for a token', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream()));
    const connector = new AguiConnector('fixture', null);
    const connecting = connector
      .connect(SessionId('stalled-body'))
      .catch((error) => error);
    const retired = connector.retire();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await connecting).toBeInstanceOf(Error);
    await retired;
    expect(connector.state.phase).toBe('stopped');
  });

  it('bounds deletion and shares cleanup even if a display observer throws', async () => {
    vi.useFakeTimers();
    let deletes = 0;
    vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => {
      if (init.method !== 'DELETE')
        return Response.json({ token: 'allocated' });
      deletes++;
      return new Promise<Response>(() => {});
    });
    const connector = new AguiConnector('fixture', null);
    await connector.connect(SessionId('stalled-delete'));
    connector.observe(() => {
      throw new Error('Display failed');
    });
    const retired = connector.retire();
    expect(connector.retire()).toBe(retired);
    await vi.advanceTimersByTimeAsync(10_000);
    await retired;
    expect(deletes).toBe(1);
  });

  it('retires a timed-out acknowledgment and ignores its later success', async () => {
    vi.useFakeTimers();
    const delivered = gate();
    const h = await setup({
      changeResponse: async (response, body) => {
        if (body.forwardedProps?.kind === 'ack') await delivered.promise;
        return response;
      },
    });
    const goal = h.connector.runGoal(h.orchestrator, 'Bounded acknowledgment');
    await vi.waitFor(() =>
      expect(h.requests.some((r) => r.forwardedProps?.kind === 'ack')).toBe(
        true,
      ),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await goal;
    expect(h.connector.state.phase).toBe('stopped');
    delivered.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.connector.state.phase).toBe('stopped');
    expect(h.creates()).toBe(1);
    expect(
      h.requests.filter((r) => r.forwardedProps?.kind === 'plan'),
    ).toHaveLength(1);
  });
  it('releases a server allocation when retirement happens before real HTTP token delivery', async () => {
    const allocated = gate();
    const deliver = gate();
    let deletes = 0;
    const server = createServer(async (request, response) => {
      if (request.method === 'DELETE') {
        deletes++;
        response.writeHead(204).end();
        return;
      }
      allocated.resolve();
      await deliver.promise;
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ token: 'late-token' }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing HTTP address');
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (path: string, init: RequestInit) =>
      nativeFetch(`http://127.0.0.1:${address.port}${path}`, init),
    );
    const connector = new AguiConnector('fixture', null);
    const connecting = connector
      .connect(SessionId('late-http'))
      .catch((error) => error);
    try {
      await allocated.promise;
      const retired = connector.retire();
      const alsoRetired = connector.retire();
      deliver.resolve();
      expect(await connecting).toBeInstanceOf(Error);
      await Promise.all([retired, alsoRetired]);
      expect(deletes).toBe(1);
    } finally {
      deliver.resolve();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('reports skipped application as unknown through the canonical settlement boundary', async () => {
    const h = await setup({ skipRunner: true });
    await h.connector.runGoal(h.orchestrator, 'No mounted runner');
    const ack = h.requests.find(
      (r) => r.forwardedProps?.kind === 'ack',
    )?.forwardedProps;
    expect(ack?.kind === 'ack' && ack.ack.status).toBe('unknown');
    expect(h.creates()).toBe(0);
  });

  it('makes intent completion unknown when acknowledgment fails after a committed write', async () => {
    const h = await setup({ dropAck: true });
    const enqueue = vi.spyOn(h.orchestrator, 'enqueueIntent');
    await h.connector.runGoal(h.orchestrator, 'Lost acknowledgment');
    expect((await enqueue.mock.results[0].value.result).status).toBe('unknown');
    expect(h.creates()).toBe(1);
  });
  it('cannot revive a session by reconnecting while completed work is being retired', async () => {
    const harness = await setup();
    await harness.connector.runGoal(
      harness.orchestrator,
      'Retire completed work',
    );
    expect(harness.connector.state.phase).toBe('complete');
    const disconnect = harness.connector.disconnect();
    await expect(harness.connector.connect(harness.sessionId)).rejects.toThrow(
      'Experimental session retired',
    );
    await disconnect;
    await harness.connector.runGoal(harness.orchestrator, 'Do not replay');
    expect(harness.connector.state.phase).toBe('stopped');
    expect(harness.creates()).toBe(1);
  });
  it('fences a delayed plan when the mode exits before application', async () => {
    const harness = await setup({
      changeResponse: async (response, body) => {
        if (body.forwardedProps?.kind === 'plan') {
          await harness.connector.disconnect();
        }
        return response;
      },
    });
    await harness.connector.runGoal(harness.orchestrator, 'Retired plan');
    expect(harness.creates()).toBe(0);
    expect(harness.orchestrator.getStructuralSnapshot().instances).toHaveLength(
      0,
    );
  });

  it('refuses a workspace response correlated to a different request', async () => {
    const harness = await setup({
      changeResponse: async (response, body) => {
        if (body.forwardedProps?.kind !== 'plan') return response;
        const original = body.forwardedProps.message.id;
        return new Response(
          (await response.text()).replaceAll(original, 'stale-response'),
          { headers: response.headers },
        );
      },
    });
    await harness.connector.runGoal(harness.orchestrator, 'Wrong response');
    expect(harness.connector.state.phase).toBe('stopped');
    expect(harness.creates()).toBe(0);
  });
  it('serializes automatic resize planning and acknowledges it before the next workspace write', async () => {
    const harness = await setup({
      onCreate: (_connector, orchestrator) => {
        orchestrator.chartManager.setDimensions({ columns: 10, rows: 8 });
        orchestrator.scheduleUpdate({
          type: 'chart_resize',
          previous: { columns: 12, rows: 8 },
          current: { columns: 10, rows: 8 },
        });
      },
    });
    await harness.connector.runGoal(harness.orchestrator, 'Resize during task');
    expect(harness.connector.state.phase).toBe('complete');
    harness.orchestrator.scheduleUpdate({
      type: 'chart_resize',
      previous: { columns: 10, rows: 8 },
      current: { columns: 9, rows: 8 },
    });
    await harness.orchestrator.flushUpdates();
    await vi.waitFor(() =>
      expect(harness.connector.state.revision).toBeGreaterThanOrEqual(3),
    );
    expect(harness.connector.state.phase).toBe('complete');
    expect(harness.creates()).toBe(1);
    const operations = harness.requests.flatMap((r) =>
      r.forwardedProps ? [r.forwardedProps] : [],
    );
    expect(operations.map((op) => op.kind)).toEqual(
      Array.from({ length: operations.length / 2 }, () => [
        'plan',
        'ack',
      ]).flat(),
    );
  });

  it('rejects a stale request revision before any application write', async () => {
    const harness = await setup({
      changeAck: (body) => {
        if (body.forwardedProps?.kind === 'plan')
          body.forwardedProps.revision = 900;
      },
    });
    await harness.connector.runGoal(harness.orchestrator, 'Stale plan');
    expect(harness.connector.state.phase).toBe('stopped');
    expect(harness.creates()).toBe(0);
  });

  it('admits only one goal even while the first plan is awaiting its acknowledgment', async () => {
    const harness = await setup();
    await Promise.all([
      harness.connector.runGoal(harness.orchestrator, 'First [DONE]'),
      harness.connector.runGoal(harness.orchestrator, 'Second'),
    ]);
    expect(harness.connector.state.phase).toBe('complete');
    expect(harness.creates()).toBe(1);
    expect(getJournalSnapshot().entries[0]?.title).toBe('First [DONE]');
  });

  it('refuses a dependent write when the observed selection changes', async () => {
    let created = false;
    const harness = await setup({
      onCreate: () => {
        created = true;
      },
      changeAck: (body) => {
        if (created && body.forwardedProps?.kind === 'plan')
          journalActions.backToList();
      },
    });
    await harness.connector.runGoal(harness.orchestrator, 'Selection guard');
    expect(harness.connector.state.phase).toBe('stopped');
    expect(harness.creates()).toBe(1);
    expect(getJournalSnapshot().entries[0]?.content).toBe('');
  });
  it('feeds a newly generated application ID into a later Planner request, once per write', async () => {
    const harness = await setup();
    await harness.connector.runGoal(
      harness.orchestrator,
      'Result-dependent proof',
    );
    expect(harness.connector.state.phase).toBe('complete');
    expect(harness.creates()).toBe(1);
    const id = harness.connector.state.observedId;
    expect(id).toBeTruthy();
    expect(getJournalSnapshot().entries.find((e) => e.id === id)?.content).toBe(
      `Generated entry ID: ${id}`,
    );
    const plans = harness.requests.flatMap((r) =>
      r.forwardedProps?.kind === 'plan' ? [r.forwardedProps] : [],
    );
    expect(plans.at(-1)?.journal.activeEntryId).toBe(id);
    const acknowledgments = harness.requests.flatMap((r) =>
      r.forwardedProps?.kind === 'ack' ? [r.forwardedProps.ack] : [],
    );
    expect(acknowledgments.filter((r) => r.actions.length)).toHaveLength(2);
    expect(acknowledgments.at(-1)?.chart.instances[0]?.vesselId).toBe(
      'journal',
    );
  });

  it.each([
    'requestId',
    'callId',
    'goalId',
    'sessionId',
    'runId',
    'revision',
  ] as const)(
    'rejects an acknowledgment with the wrong %s without a dependent write',
    async (field) => {
      const harness = await setup({
        changeAck: (body) => {
          if (
            body.forwardedProps?.kind === 'ack' &&
            body.forwardedProps.ack.actions.length
          ) {
            if (field === 'revision')
              body.forwardedProps.ack.correlation.revision = 900;
            else body.forwardedProps.ack.correlation[field] = 'stale';
          }
        },
      });
      await harness.connector.runGoal(harness.orchestrator, `Stale ${field}`);
      expect(harness.connector.state.phase).toBe('stopped');
      expect(harness.creates()).toBe(1);
      expect(getJournalSnapshot().entries[0]?.content).toBe('');
    },
  );

  it('does not infer application success from RUN_FINISHED when an Action fails', async () => {
    const harness = await setup({ failAction: true });
    await harness.connector.runGoal(harness.orchestrator, 'Failed create');
    expect(harness.connector.state.phase).toBe('stopped');
    expect(harness.creates()).toBe(0);
    expect(harness.connector.state.observedId).toBeNull();
  });

  it('leaves a successful create intact after its acknowledgment is lost, with no retry', async () => {
    const harness = await setup({ dropAck: true });
    await harness.connector.runGoal(harness.orchestrator, 'Unknown outcome');
    await harness.connector.runGoal(harness.orchestrator, 'Do not retry');
    expect(harness.connector.state.phase).toBe('stopped');
    expect(harness.creates()).toBe(1);
    expect(getJournalSnapshot().entries[0]?.content).toBe('');
  });

  it('retires continuation when the user leaves the mode after create', async () => {
    const harness = await setup({
      onCreate: (connector) => {
        void connector.disconnect();
      },
    });
    await harness.connector.runGoal(
      harness.orchestrator,
      'Exit while applying',
    );
    expect(harness.connector.state.phase).toBe('stopped');
    expect(harness.creates()).toBe(1);
    expect(getJournalSnapshot().entries[0]?.content).toBe('');
  });

  it('requires the authoritative Chart snapshot, even with successful Action outcomes', async () => {
    const harness = await setup({
      changeAck: (body) => {
        if (body.forwardedProps?.kind === 'ack')
          body.forwardedProps.ack.chart.instances = [];
      },
    });
    await harness.connector.runGoal(harness.orchestrator, 'Wrong Chart');
    expect(harness.connector.state.phase).toBe('stopped');
    expect(harness.connector.state.observedId).toBeNull();
  });
});
