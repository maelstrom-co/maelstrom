import { createEngine } from '@maelstrom-co/engine';
import { ok, TilingResponseSchema } from '@maelstrom-co/protocol';
import { createLiveSessionExchange } from '@maelstrom-co/realtime-openai-live-server';
import { fakeText } from '@tanstack/ai/testing';

import { routeWorkspace } from '../src/worker/router';
import { WorkspaceDO } from '../src/worker/workspace-do';

function latch() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

export class WorkspaceFixture extends WorkspaceDO {
  private readonly pause;
  private readonly expired = latch();
  constructor(ctx: DurableObjectState, env: Env & { VOICE_UPSTREAM?: string }) {
    const voiceUpstream = env.VOICE_UPSTREAM;
    const pause = { enabled: false, entered: latch(), release: latch() };
    const adapter = Object.assign(fakeText(), {
      supportsCombinedToolsAndSchema: () => true,
    });
    adapter.setResponses([
      {
        toolCalls: [
          {
            id: 'create',
            name: 'apply_workspace',
            input: {
              intent: 'Create a durable Task',
              expectedMutation: { kind: 'task.create', title: 'Durable Task' },
            },
          },
        ],
      },
      { text: JSON.stringify({ status: 'completed', message: 'Task saved.' }) },
    ]);
    super(ctx, env, {
      voiceExchange: voiceUpstream
        ? (apiKey) =>
            createLiveSessionExchange({
              apiKey,
              fetch: ((_input, init) =>
                fetch(voiceUpstream, init)) as typeof fetch,
            })
        : undefined,
      adapter: () => adapter,
      engine: () =>
        createEngine({
          retry: false,
          logger: { debug() {}, info() {}, warn() {}, error() {} },
          planner: async ({ request }) => {
            if (pause.enabled) {
              pause.entered.resolve();
              await pause.release.promise;
            }
            return ok(
              TilingResponseSchema.parse({
                type: 'plan',
                userMessage: 'Create Task',
                rationale: 'Workerd durability fixture',
                layout: !request.context.updateReasons.some(
                  (reason) => reason.type === 'user_intent',
                )
                  ? request.layout
                  : {
                      tree: ['ID:tasks'],
                      instances: [
                        {
                          instanceId: 'tasks',
                          vesselId: 'tasks',
                          variant: 'list',
                        },
                      ],
                    },
                executionPlan: request.context.updateReasons.some(
                  (reason) => reason.type === 'user_intent',
                )
                  ? [
                      {
                        instanceId: 'tasks',
                        action: 'addTask',
                        paramsJson: JSON.stringify({ title: 'Durable Task' }),
                      },
                    ]
                  : [],
              }),
            );
          },
        }),
    });
    this.pause = pause;
  }

  override async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === '/__fixture/inspect') {
      return Response.json({
        alarm: await this.ctx.storage.getAlarm(),
        access: [
          ...this.ctx.storage.sql.exec('SELECT * FROM workspace_access'),
        ],
        bindings: [
          ...this.ctx.storage.sql.exec('SELECT * FROM workspace_bindings'),
        ],
        records: [
          ...this.ctx.storage.sql.exec('SELECT * FROM workspace_records'),
        ],
        plans: [...this.ctx.storage.sql.exec('SELECT * FROM issued_plans')],
      });
    }
    if (path === '/__fixture/fail-receipt') {
      this.ctx.storage.sql
        .exec(`CREATE TRIGGER fail_receipt BEFORE UPDATE ON issued_plans
        WHEN json_extract(NEW.payload, '$.receipt') IS NOT NULL
        BEGIN SELECT RAISE(ABORT, 'Injected receipt failure'); END;`);
      return new Response('Ready');
    }
    if (path === '/__fixture/expire') {
      this.ctx.storage.sql.exec(
        'UPDATE workspace_access SET expires_at = ? WHERE id = 1',
        Date.now() + 1_000,
      );
      await this.ctx.storage.setAlarm(Date.now() + 1_000);
      return new Response('Scheduled');
    }
    if (path === '/__fixture/await-expiry') {
      await this.expired.promise;
      return new Response('Expired');
    }
    if (path === '/__fixture/hold') {
      this.pause.enabled = true;
      return new Response('Held');
    }
    if (path === '/__fixture/entered') {
      await this.pause.entered.promise;
      return new Response('Entered');
    }
    if (path === '/__fixture/release') {
      this.pause.enabled = false;
      this.pause.release.resolve();
      return new Response('Released');
    }
    return super.fetch(request);
  }

  override async alarm() {
    await super.alarm();
    this.expired.resolve();
  }
}

export default { fetch: routeWorkspace };
