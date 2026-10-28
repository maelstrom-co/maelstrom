import { afterEach, describe, expect, it } from 'bun:test';
import { EventSchemas } from '@ag-ui/core/schemas';
import {
  APPLICATION_RESULT,
  ApplicationResultSchema,
  WORKSPACE_RESULT,
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
    instanceId?: string;
    replaceAfterPlan?: boolean;
    output?: (event: unknown, operation: WorkspaceOperation) => unknown;
  } = {},
) {
  const sessionId = SessionId('headless');
  const instanceId = options.instanceId ?? 'counter';
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
            tree: [`ID:${instanceId}`],
            instances: [{ instanceId, vesselId: 'counter', variant: 'main' }],
          },
          executionPlan: [
            { instanceId, action: 'increment', paramsJson: '{}' },
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
            const output = options.output
              ? options.output(event, input.forwardedProps)
              : event;
            if (output !== undefined)
              workspace.receive(JSON.stringify(output), true);
            if (
              options.replaceAfterPlan &&
              input.forwardedProps.kind === 'plan' &&
              EventSchemas.parse(event).type === 'RUN_FINISHED'
            )
              workspace.open(() => {}, sessionId);
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
        InstanceId(instanceId),
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
  it('does not poison a replacement binding when an old planning promise resumes', async () => {
    const h = await setup({ replaceAfterPlan: true });
    expect((await h.client.enqueueIntent('increment').result).status).toBe(
      'unknown',
    );
    expect(h.workspace.snapshot()).toBeNull();
    expect(h.writes()).toBe(0);
    expect(h.settlements).toHaveLength(0);
  });
  for (const kind of ['plan', 'applied'] as const) {
    for (const outcome of [
      {
        type: 'interrupt',
        interrupts: [{ id: 'approval', reason: 'approval-required' }],
      },
      { type: 'cancelled' },
      { type: 'success', pendingToolCallIds: ['unresolved'] },
    ]) {
      it(`stops ${kind} with unsupported terminal ${outcome.type} without replaying writes`, async () => {
        const h = await setup({
          output: (value, operation) => {
            const event = EventSchemas.parse(value);
            return operation.kind === kind && event.type === 'RUN_FINISHED'
              ? EventSchemas.parse({ ...event, outcome })
              : event;
          },
        });
        expect((await h.client.enqueueIntent('increment').result).status).toBe(
          'unknown',
        );
        expect(h.workspace.snapshot()?.code).toBe('invalid_run');
        expect((await h.client.enqueueIntent('later').result).status).toBe(
          'unknown',
        );
        expect(h.plans()).toBe(1);
        expect(h.writes()).toBe(kind === 'plan' ? 0 : 1);
        expect(h.settlements).toHaveLength(kind === 'plan' ? 0 : 1);
      });
    }
  }

  it('accepts explicit success only when no tool calls remain pending', async () => {
    const h = await setup({
      output: (value) => {
        const event = EventSchemas.parse(value);
        return event.type === 'RUN_FINISHED'
          ? EventSchemas.parse({
              ...event,
              outcome: { type: 'success', pendingToolCallIds: [] },
            })
          : event;
      },
    });
    expect((await h.client.enqueueIntent('increment').result).status).toBe(
      'applied',
    );
    expect((await h.client.enqueueIntent('again').result).status).toBe(
      'applied',
    );
    expect(h.writes()).toBe(2);
  });

  it('settles a timed-out acknowledgment even when an error observer throws', async () => {
    const h = await setup({
      output: (event, operation) =>
        operation.kind === 'applied' ? undefined : event,
    });
    const observed: unknown[] = [];
    h.workspace.observe(() => {
      throw new Error('Broken display observer');
    });
    h.workspace.observe(() => {
      observed.push(h.workspace.snapshot());
    });
    const first = h.client.enqueueIntent('increment');
    const second = h.client.enqueueIntent('later');
    expect((await first.result).status).toBe('unknown');
    expect((await second.result).status).toBe('unknown');
    expect(h.workspace.snapshot()?.code).toBe('run_timeout');
    expect(observed).toEqual([h.workspace.snapshot()]);
    expect(h.writes()).toBe(1);
    expect(h.plans()).toBe(1);
  });

  it('acknowledges a valid long Instance identity and admits subsequent work', async () => {
    const h = await setup({ instanceId: 'x'.repeat(257) });
    expect((await h.client.enqueueIntent('increment').result).status).toBe(
      'applied',
    );
    expect((await h.client.enqueueIntent('again').result).status).toBe(
      'applied',
    );
    expect(h.writes()).toBe(2);
    expect(h.workspace.snapshot()).toBeNull();
  });

  for (const field of ['threadId', 'requestId', 'revision'] as const) {
    it(`classifies mismatched result ${field} as invalid output before application`, async () => {
      const h = await setup({
        output: (value) => {
          const event = EventSchemas.parse(value);
          if (event.type !== 'CUSTOM' || event.name !== WORKSPACE_RESULT)
            return event;
          return {
            ...event,
            value: {
              ...event.value,
              correlation: {
                ...event.value.correlation,
                [field]: field === 'revision' ? 99 : 'wrong',
              },
            },
          };
        },
      });
      await h.client.enqueueIntent('increment').result;
      expect(h.workspace.snapshot()?.code).toBe('invalid_run');
      expect(h.writes()).toBe(0);
      expect(h.settlements).toHaveLength(0);
    });
  }

  for (const field of [
    'threadId',
    'runId',
    'requestId',
    'callId',
    'revision',
    'acceptedRevision',
    'shape',
  ] as const) {
    it(`rejects invalid acknowledgment ${field} without replaying the committed Action`, async () => {
      const h = await setup({
        output: (value) => {
          const event = EventSchemas.parse(value);
          if (event.type !== 'CUSTOM' || event.name !== APPLICATION_RESULT)
            return event;
          const result = ApplicationResultSchema.parse(event.value);
          if (field === 'shape') return { ...event, value: null };
          if (field === 'acceptedRevision')
            return { ...event, value: { ...result, revision: 99 } };
          return {
            ...event,
            value: {
              ...result,
              correlation: {
                ...result.correlation,
                [field]: field === 'revision' ? 99 : 'wrong',
              },
            },
          };
        },
      });
      expect((await h.client.enqueueIntent('increment').result).status).toBe(
        'unknown',
      );
      expect(h.workspace.snapshot()?.code).toBe('invalid_run');
      expect((await h.client.enqueueIntent('later').result).status).toBe(
        'unknown',
      );
      expect(h.writes()).toBe(1);
      expect(h.plans()).toBe(1);
    });
  }

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
