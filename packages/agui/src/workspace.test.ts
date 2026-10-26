import { afterEach, describe, expect, it } from 'bun:test';
import {
  type WorkspaceCheckpoint,
  type WorkspaceOperation,
  WorkspaceRunSchema,
} from '@maelstrom-co/agui-protocol';
import { AguiWorkspaceSession } from '@maelstrom-co/agui-server';
import {
  type ApplicationSettlement,
  type EngineConnector,
  Orchestrator,
} from '@maelstrom-co/client';
import { createEngine } from '@maelstrom-co/engine';
import {
  defineVessel,
  err,
  InstanceId,
  ok,
  SessionId,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';
import { AguiWorkspaceClient } from './browser.js';

const vessel = defineVessel({
  id: 'counter',
  name: 'Counter',
  description: 'Count committed writes',
  defaultVariant: 'main',
  variants: {
    main: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [
        { name: 'increment', description: 'Commit one write', parameters: [] },
      ],
    },
  },
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup(
  options: {
    failAction?: boolean;
    loseAck?: boolean;
    truncate?: boolean;
    rejectRun?: boolean;
  } = {},
) {
  const sessionId = SessionId('headless');
  const workspace = new AguiWorkspaceClient(100);
  const operations: WorkspaceOperation[] = [];
  const settlements: ApplicationSettlement[] = [];
  let checkpoint: WorkspaceCheckpoint | undefined;
  const save = (value: WorkspaceCheckpoint) => {
    checkpoint = structuredClone(value);
  };
  let server = new AguiWorkspaceSession(sessionId, undefined, save);
  let writes = 0;
  let plans = 0;
  const engine = createEngine({
    retry: false,
    planner: async () => {
      plans++;
      return ok(
        TilingResponseSchema.parse({
          userMessage: 'Done',
          rationale: '',
          layout: {
            tree: ['ID:counter'],
            instances: [
              { instanceId: 'counter', vesselId: 'counter', variant: 'main' },
            ],
          },
          executionPlan: [
            { instanceId: 'counter', action: 'increment', paramsJson: '{}' },
          ],
        }),
      );
    },
  });
  const connector: EngineConnector = {
    capabilities: { voice: false, streaming: true, stateful: true },
    connect: async () =>
      workspace.open((wire) => {
        const input = WorkspaceRunSchema.parse(JSON.parse(wire).input);
        operations.push(input.forwardedProps);
        if (options.rejectRun) {
          workspace.receive(
            JSON.stringify({
              type: 'RUN_STARTED',
              threadId: input.threadId,
              runId: input.runId,
            }),
            true,
          );
          workspace.receive(
            JSON.stringify({
              type: 'RUN_ERROR',
              message: 'provider-secret-canary',
              code: 'UNTRUSTED_HOST_CODE',
            }),
            true,
          );
          return;
        }
        if (options.loseAck && input.forwardedProps.kind === 'applied') {
          workspace.disconnect();
          return;
        }
        void server.run(
          input,
          () => engine,
          (event) => {
            if (
              options.truncate &&
              (event as { type: string }).type === 'RUN_FINISHED'
            )
              return;
            workspace.receive(JSON.stringify(event), true);
          },
        );
      }, sessionId),
    disconnect: async () => {
      workspace.disconnect();
      server.close();
    },
    process: (message) => workspace.process(message),
    applicationSettled: (settlement) => {
      settlements.push(settlement);
      return workspace.applicationSettled(settlement);
    },
    subscribe: () => () => {},
    addAssistantMessage: async () => {},
    getHistory: async () => [],
  };
  const client = new Orchestrator(connector, {
    sessionId,
    vessels: [vessel],
    layoutMode: 'tiling',
  });
  cleanups.push(() => client.dispose());
  client.commandProcessor.events.on('command_complete', ({ command }) => {
    if (command.kind === 'set_layout')
      client.commandProcessor.registerRunner<typeof vessel>(
        InstanceId('counter'),
        {
          increment: () => {
            if (options.failAction) return err(new Error('Write unavailable'));
            writes++;
            return ok(undefined);
          },
        },
      );
  });
  client.chartManager.setDimensions({ columns: 12, rows: 8 });
  await client.connect();
  return {
    client,
    workspace,
    operations,
    settlements,
    writes: () => writes,
    plans: () => plans,
    wake: () => {
      server = new AguiWorkspaceSession(sessionId, checkpoint, save);
    },
  };
}

describe('headless workspace adapter', () => {
  it('applies and acknowledges FIFO work without a React observer, then resumes from a checkpoint', async () => {
    const h = await setup();
    const first = h.client.enqueueIntent('increment');
    const second = h.client.enqueueIntent('increment again');
    expect((await first.result).status).toBe('applied');
    expect((await second.result).status).toBe('applied');
    expect(h.writes()).toBe(2);
    expect(h.operations.map((op) => op.kind)).toEqual([
      'plan',
      'applied',
      'plan',
      'applied',
    ]);
    expect(h.settlements[0].chart.instances[0].instanceId).toBe(
      InstanceId('counter'),
    );
    h.wake();
    expect((await h.client.enqueueIntent('after wake').result).status).toBe(
      'applied',
    );
    expect(h.writes()).toBe(3);
  });

  it('preserves unknown application outcomes and refuses later planning', async () => {
    const h = await setup({ failAction: true });
    expect((await h.client.enqueueIntent('increment').result).status).toBe(
      'unknown',
    );
    expect(h.operations[1]).toMatchObject({
      kind: 'applied',
      application: { status: 'unknown', actions: [{ succeeded: false }] },
    });
    expect((await h.client.enqueueIntent('later').result).status).toBe(
      'unknown',
    );
    expect(h.plans()).toBe(1);
    expect(h.writes()).toBe(0);
    expect(h.workspace.snapshot()?.code).toBe('application_unknown');
  });

  it('reports lost acknowledgment as unknown without replaying the committed write', async () => {
    const h = await setup({ loseAck: true });
    expect((await h.client.enqueueIntent('increment').result).status).toBe(
      'unknown',
    );
    expect((await h.client.enqueueIntent('later').result).status).toBe(
      'unknown',
    );
    expect(h.writes()).toBe(1);
    expect(h.plans()).toBe(1);
    expect(h.workspace.snapshot()?.code).toBe('connection_lost');
  });

  it('never applies a response from an incomplete run', async () => {
    const h = await setup({ truncate: true });
    expect((await h.client.enqueueIntent('increment').result).status).toBe(
      'unknown',
    );
    expect(h.writes()).toBe(0);
    expect(h.settlements).toHaveLength(0);
    expect(h.workspace.snapshot()?.code).toBe('run_timeout');
  });

  it('exposes a stable local failure reason without forwarding remote text to application UI', async () => {
    const h = await setup({ rejectRun: true });
    const result = await h.client.enqueueIntent('increment').result;
    expect(result).toMatchObject({
      status: 'unknown',
      error: { code: 'run_failed' },
    });
    const failure = h.workspace.snapshot();
    expect(failure?.message).not.toContain('provider-secret-canary');
    await h.client.enqueueIntent('later').result;
    expect(h.workspace.snapshot()).toBe(failure);
    expect(h.operations).toHaveLength(1);
    expect(h.writes()).toBe(0);
  });
});
