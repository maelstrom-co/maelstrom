import { afterEach, describe, expect, test } from 'bun:test';

import { WorkspaceRunSchema } from '@maelstrom-co/agui-protocol';
import { AguiWorkspaceSession } from '@maelstrom-co/agui-server';
import { Orchestrator, WebSocketConnector } from '@maelstrom-co/client';
import { createEngine, handleEnvelope } from '@maelstrom-co/engine';
import {
  AgentEventMessage,
  type ChartRequest,
  decodeClientEnvelope,
  defineVessel,
  encodeEnvelope,
  err,
  InstanceId,
  isErr,
  ok,
  SessionId,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';

import { AguiWebSocketConnector } from './browser.js';

const vessel = defineVessel({
  id: 'records',
  name: 'Records',
  description: 'Store committed records',
  defaultVariant: 'main',
  variants: {
    main: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [
        {
          name: 'append',
          description: 'Commit a record',
          effect: 'any',
          parameters: [],
        },
      ],
    },
  },
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(mode: 'legacy' | 'agent' | 'agui', failSecond = false) {
  const sessionId = SessionId(`effects-${mode}`);
  const requests: ChartRequest[] = [];
  const records: number[] = [];
  const appliedLayouts: string[][] = [];
  const errors: unknown[] = [];
  const mounted = deferred();
  const runnerReady = deferred();
  const writing = deferred();
  const commit = deferred();
  let attempts = 0;
  const engine = createEngine({
    retry: false,
    planner: async ({ request }) => {
      requests.push(structuredClone(request));
      return ok(
        TilingResponseSchema.parse({
          type: 'plan',
          userMessage: 'Recorded',
          rationale: 'Effect parity fixture',
          layout: {
            tree: ['ID:active'],
            instances: [
              { instanceId: 'active', vesselId: 'records', variant: 'main' },
              { instanceId: 'retained', vesselId: 'records', variant: 'main' },
            ],
          },
          executionPlan: Array.from({ length: failSecond ? 2 : 1 }, () => ({
            instanceId: 'active',
            action: 'append',
            paramsJson: '{}',
          })),
        }),
      );
    },
  });
  const native = engine.openConnection({ sessionId, user: null });
  const workspace = new AguiWorkspaceSession(sessionId);
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, host) {
      if (host.upgrade(request)) return;
      return new Response('WebSocket required', { status: 400 });
    },
    websocket: {
      open(socket) {
        native.subscribe((event) =>
          socket.send(encodeEnvelope(AgentEventMessage({ sessionId, event }))),
        );
      },
      async message(socket, raw) {
        try {
          if (mode === 'agui') {
            const run = WorkspaceRunSchema.parse(JSON.parse(String(raw)).input);
            await workspace.run(
              run,
              () => engine,
              (event) => {
                socket.send(JSON.stringify(event));
              },
            );
          } else {
            const decoded = decodeClientEnvelope(raw);
            if (isErr(decoded)) throw decoded.error;
            if (decoded.value.type === 'client.agent.input')
              await native.send(decoded.value.input);
            else {
              const reply = await handleEnvelope(engine, raw);
              if (reply) socket.send(encodeEnvelope(reply));
            }
          }
        } catch (error) {
          errors.push(error);
          socket.close(1011);
        }
      },
    },
  });
  const url = `ws://127.0.0.1:${server.port}`;
  const connector =
    mode === 'agui'
      ? new AguiWebSocketConnector({ url })
      : new WebSocketConnector({ url, protocol: mode });
  const client = new Orchestrator(connector, { sessionId, vessels: [vessel] });
  cleanups.push(async () => {
    commit.resolve();
    runnerReady.resolve();
    await client.dispose();
    native.close();
    workspace.close();
    await server.stop(true);
  });
  client.commandProcessor.events.on('command_complete', ({ command }) => {
    if (command.kind !== 'set_layout') return;
    appliedLayouts.push([
      ...client.commandProcessor.store.state.instances.keys(),
    ]);
    mounted.resolve();
    void runnerReady.promise.then(() =>
      client.commandProcessor.registerRunner(InstanceId('active'), {
        append: async () => {
          attempts++;
          if (failSecond && attempts === 2)
            return err(new Error('Second write failed after first committed'));
          writing.resolve();
          await commit.promise;
          records.push(records.length + 1);
          return ok(undefined);
        },
      }),
    );
  });
  await client.connect();
  return {
    client,
    requests,
    records,
    appliedLayouts,
    errors,
    mounted,
    runnerReady,
    writing,
    commit,
    attempts: () => attempts,
  };
}

for (const mode of ['legacy', 'agent', 'agui'] as const) {
  describe(`${mode} application effects`, () => {
    test('dependent work observes a committed write and retained Chart only after runner readiness and settlement', async () => {
      const h = await setup(mode);
      const first = h.client.enqueueIntent('append first record');
      const second = h.client.enqueueIntent('use first record');
      await h.mounted.promise;
      expect(h.appliedLayouts).toEqual([['active', 'retained']]);
      expect(h.records).toEqual([]);
      expect(h.requests).toHaveLength(1);
      h.runnerReady.resolve();
      await h.writing.promise;
      expect(h.records).toEqual([]);
      expect(h.requests).toHaveLength(1);
      h.commit.resolve();
      expect((await first.result).status).toBe('applied');
      expect((await second.result).status).toBe('applied');
      expect(h.records).toEqual([1, 2]);
      expect(h.attempts()).toBe(2);
      expect(h.requests[1]).toMatchObject({
        instances: [{ instanceId: 'active' }, { instanceId: 'retained' }],
        context: {
          updateReasons: [{ type: 'user_intent', intent: 'use first record' }],
        },
      });
      expect(h.errors).toEqual([]);
    });

    test('a partially committed batch remains unknown and never repeats the committed Action', async () => {
      const h = await setup(mode, true);
      h.runnerReady.resolve();
      h.commit.resolve();
      expect((await h.client.enqueueIntent('append twice').result).status).toBe(
        'unknown',
      );
      expect(h.records).toEqual([1]);
      expect(h.attempts()).toBe(2);
      expect(h.requests).toHaveLength(1);
      expect(h.errors).toEqual([]);
    });
  });
}
