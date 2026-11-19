import { expect, test } from 'bun:test';

import { WorkspaceRunSchema } from '@maelstrom-co/agui-protocol';
import { AguiWorkspaceSession } from '@maelstrom-co/agui-server';
import { Orchestrator } from '@maelstrom-co/client';
import { createEngine } from '@maelstrom-co/engine';
import {
  defineVessel,
  InstanceId,
  ok,
  SessionId,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';

import type { WorkspaceExchange } from '../contracts';
import { WorkspaceConnector } from './workspace-connector';

function latch() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const vessel = defineVessel({
  id: 'records',
  name: 'Records',
  description: 'Test committed records.',
  defaultVariant: 'main',
  variants: {
    main: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [{ name: 'append', description: 'Append a record.' }],
    },
  },
});

async function setup(dropAck = false) {
  const sessionId = SessionId();
  const server = new AguiWorkspaceSession(sessionId);
  const writing = latch();
  const commit = latch();
  const acknowledging = latch();
  const releaseAck = latch();
  const exchanges: WorkspaceExchange[] = [];
  let writes = 0;
  const engine = createEngine({
    retry: false,
    planner: async ({ request }) =>
      ok(
        TilingResponseSchema.parse({
          type: 'plan',
          userMessage: 'Recorded',
          rationale: 'Canonical tool settlement test',
          layout: {
            tree: ['ID:active'],
            instances: [
              { instanceId: 'active', vesselId: 'records', variant: 'main' },
              { instanceId: 'retained', vesselId: 'records', variant: 'main' },
            ],
          },
          executionPlan: request.context.updateReasons.some(
            (reason) => reason.type === 'user_intent',
          )
            ? [{ instanceId: 'active', action: 'append', paramsJson: '{}' }]
            : [],
        }),
      ),
  });
  const connector = new WorkspaceConnector(async (input) => {
    exchanges.push(structuredClone(input));
    const run = WorkspaceRunSchema.parse(JSON.parse(input.frame).input);
    const events: unknown[] = [];
    await server.run(
      run,
      () => engine,
      (event) => {
        events.push(event);
      },
    );
    if (run.forwardedProps.kind === 'applied' && input.toolCallId) {
      acknowledging.resolve();
      await releaseAck.promise;
      if (dropAck)
        throw new Error('Response lost after the server accepted it.');
    }
    return events;
  });
  const orchestrator = new Orchestrator(connector, {
    sessionId,
    vessels: [vessel],
  });
  orchestrator.commandProcessor.events.on('command_complete', ({ command }) => {
    if (command.kind !== 'set_layout') return;
    orchestrator.commandProcessor.registerRunner(InstanceId('active'), {
      append: async () => {
        connector.claimAction('active', 'append');
        writing.resolve();
        await commit.promise;
        writes++;
        return ok(undefined);
      },
    });
  });
  await orchestrator.connect();
  return {
    connector,
    orchestrator,
    exchanges,
    writing,
    commit,
    acknowledging,
    releaseAck,
    writes: () => writes,
    close: async () => {
      commit.resolve();
      releaseAck.resolve();
      server.close();
      await orchestrator.dispose();
    },
  };
}

test('a frontend tool waits for the write and acknowledged canonical settlement, including retained instances', async () => {
  const h = await setup();
  try {
    let completed = false;
    const work = h.connector
      .apply(h.orchestrator, 'call-1', 'Append')
      .then((value) => {
        completed = true;
        return value;
      });
    await h.writing.promise;
    expect(completed).toBe(false);
    expect(h.writes()).toBe(0);
    h.commit.resolve();
    await h.acknowledging.promise;
    expect(h.writes()).toBe(1);
    expect(completed).toBe(false);
    h.releaseAck.resolve();
    const settled = await work;
    expect(settled.result.status).toBe('applied');
    expect(
      settled.chartRequest?.instances.map(({ instanceId }) => instanceId),
    ).toEqual([InstanceId('active'), InstanceId('retained')]);
    expect(settled.actions).toMatchObject([
      { instanceId: 'active', action: 'append', succeeded: true },
    ]);
    expect(h.exchanges.map(({ toolCallId }) => toolCallId)).toEqual([
      'call-1',
      'call-1',
    ]);
    expect(h.exchanges[1].observation).toEqual(settled.chartRequest);
  } finally {
    await h.close();
  }
});

test('loss of an acknowledgment after a committed write stops continuation without repeating it', async () => {
  const h = await setup(true);
  try {
    h.commit.resolve();
    h.releaseAck.resolve();
    await expect(
      h.connector.apply(h.orchestrator, 'call-1', 'Append'),
    ).rejects.toThrow('not confirmed');
    await expect(
      h.connector.apply(h.orchestrator, 'call-2', 'Append again'),
    ).rejects.toThrow('unavailable');
    expect(h.writes()).toBe(1);
    expect(h.exchanges).toHaveLength(2);
  } finally {
    await h.close();
  }
});

test('a retired binding cannot reconnect and reset its protocol counters', async () => {
  const h = await setup();
  try {
    await h.connector.disconnect();
    await expect(h.connector.connect(SessionId())).rejects.toThrow('retired');
    expect(h.exchanges).toEqual([]);
  } finally {
    await h.close();
  }
});

test('automatic resize settlement cannot satisfy the next frontend tool', async () => {
  const h = await setup();
  try {
    h.orchestrator.scheduleUpdate({
      type: 'chart_resize',
      previous: { rows: 8, columns: 12 },
      current: { rows: 7, columns: 10 },
    });
    await h.orchestrator.flushUpdates();
    h.commit.resolve();
    h.releaseAck.resolve();
    const settled = await h.connector.apply(
      h.orchestrator,
      'after-resize',
      'Append',
    );
    expect(h.exchanges.map(({ toolCallId }) => toolCallId)).toEqual([
      undefined,
      undefined,
      'after-resize',
      'after-resize',
    ]);
    expect(settled.actions).toHaveLength(1);
    expect(h.writes()).toBe(1);
  } finally {
    await h.close();
  }
});
