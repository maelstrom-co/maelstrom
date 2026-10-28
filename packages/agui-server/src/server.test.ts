import { describe, expect, it, mock } from 'bun:test';
import {
  type WorkspaceCheckpoint,
  type WorkspaceOperation,
  WorkspaceResultSchema,
  workspaceRun,
} from '@maelstrom-co/agui-protocol';
import { createEngine } from '@maelstrom-co/engine';
import {
  ChartRequestMessageSchema,
  defineVessel,
  ok,
  SessionId,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';
import { AguiWorkspaceSession } from './server.js';

const recordVessel = defineVessel({
  id: 'record',
  name: 'Record',
  description: 'Create a record',
  defaultVariant: 'entry',
  variants: {
    entry: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [
        {
          name: 'createEntry',
          description: 'Create one entry',
          parameters: [
            { name: 'title', type: 'string', description: 'Entry title' },
          ],
        },
      ],
    },
  },
});

function setup() {
  const planner = mock(async () =>
    ok(
      TilingResponseSchema.parse({
        userMessage: 'Created',
        rationale: '',
        layout: {
          tree: ['ID:entry'],
          instances: [
            { instanceId: 'entry', vesselId: 'record', variant: 'entry' },
          ],
        },
        executionPlan: [
          {
            instanceId: 'entry',
            action: 'createEntry',
            paramsJson: '{"title":"Example"}',
          },
        ],
      }),
    ),
  );
  const engine = createEngine({ planner, retry: false });
  let checkpoint: WorkspaceCheckpoint | undefined;
  let session = new AguiWorkspaceSession('session', undefined, (value) => {
    checkpoint = structuredClone(value);
  });
  const run = async (operation: WorkspaceOperation) => {
    const events: unknown[] = [];
    await session.run(
      workspaceRun('session', operation),
      () => engine,
      (event) => events.push(event),
    );
    return events;
  };
  const plan = (sequence = 1, revision = 0): WorkspaceOperation => ({
    kind: 'plan',
    sequence,
    revision,
    message: ChartRequestMessageSchema.parse({
      type: 'chart_request',
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      sessionId: SessionId('session'),
      request: {
        type: 'chart_request',
        context: {
          layoutMode: 'tiling',
          chartDimensions: { rows: 8, columns: 12 },
          updateReasons: [{ type: 'user_intent', intent: 'Create an entry' }],
        },
        vessels: [recordVessel],
        instances: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      },
    }),
  });
  const apply = (
    events: unknown[],
    sequence = 2,
  ): WorkspaceOperation & { kind: 'applied' } => {
    const event = events[1] as { value: unknown };
    const result = WorkspaceResultSchema.parse(event.value);
    return {
      kind: 'applied',
      sequence,
      application: {
        correlation: result.correlation,
        status: 'applied',
        actions: result.envelope.response.executionPlan.map(
          ({ instanceId, action }) => ({ instanceId, action, succeeded: true }),
        ),
        chart: {
          instances: [],
          layout: null,
          layoutMode: 'tiling',
          chartDimensions: { rows: 8, columns: 12 },
        },
      },
    };
  };
  return {
    planner,
    run,
    plan,
    apply,
    checkpoint: () => checkpoint,
    wake: () => {
      session = new AguiWorkspaceSession('session', checkpoint, (value) => {
        checkpoint = structuredClone(value);
      });
    },
  };
}

describe('AG-UI workspace admission', () => {
  it('retains only correlation evidence across hibernation, then accepts the next snapshot after acknowledgment', async () => {
    const h = setup();
    const events = await h.run(h.plan());
    expect(events).toEqual([
      expect.objectContaining({ type: 'RUN_STARTED' }),
      expect.objectContaining({
        type: 'CUSTOM',
        name: 'demo:workspace-result',
      }),
      expect.objectContaining({ type: 'RUN_FINISHED' }),
    ]);
    expect(JSON.stringify(h.checkpoint())).not.toContain('Example');
    expect(JSON.stringify(h.checkpoint())).not.toContain('createEntry');
    h.wake();
    const acknowledgment = await h.run(h.apply(events));
    expect(acknowledgment.at(-1)).toMatchObject({ type: 'RUN_FINISHED' });
    h.wake();
    await h.run(h.plan(3, 1));
    expect(h.planner).toHaveBeenCalledTimes(2);
  });

  it('never replans while application outcome is unknown', async () => {
    const h = setup();
    await h.run(h.plan());
    h.wake();
    expect((await h.run(h.plan(2))).at(-1)).toMatchObject({
      type: 'RUN_ERROR',
    });
    expect(h.planner).toHaveBeenCalledTimes(1);
    expect(h.checkpoint()?.stopped).toBe(true);
  });

  it.each([
    'callId',
    'runId',
    'threadId',
    'requestId',
  ] as const)('rejects a mismatched %s before another write can be planned', async (field) => {
    const h = setup();
    const applied = h.apply(await h.run(h.plan()));
    applied.application.correlation[field] = 'other';
    expect((await h.run(applied)).at(-1)).toMatchObject({ type: 'RUN_ERROR' });
    await h.run(h.plan(3, 1));
    expect(h.planner).toHaveBeenCalledTimes(1);
  });

  it('rejects missing action evidence and duplicate completed runs', async () => {
    const h = setup();
    const applied = h.apply(await h.run(h.plan()));
    applied.application.actions = [];
    expect((await h.run(applied)).at(-1)).toMatchObject({ type: 'RUN_ERROR' });
    const other = setup();
    const accepted = other.apply(await other.run(other.plan()));
    await other.run(accepted);
    other.wake();
    expect((await other.run(accepted)).at(-1)).toMatchObject({
      type: 'RUN_ERROR',
    });
    expect(other.planner).toHaveBeenCalledTimes(1);
  });

  it('stops on a partial application without inventing success', async () => {
    const h = setup();
    const applied = h.apply(await h.run(h.plan()));
    applied.application.actions[0].succeeded = false;
    const events = await h.run(applied);
    expect(events[1]).toMatchObject({ value: { status: 'unknown' } });
    expect(h.checkpoint()?.stopped).toBe(true);
  });
});
