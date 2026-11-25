import { expect, spyOn, test } from 'bun:test';

import { WORKSPACE_RUN, workspaceRun } from '@maelstrom-co/agui-protocol';
import { Orchestrator } from '@maelstrom-co/client';
import { createEngine } from '@maelstrom-co/engine';
import {
  ChartRequestMessage,
  ChartRequestSchema,
  InstanceId,
  ok,
  SessionId,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';
import { fakeText } from '@tanstack/ai/testing';
import { z } from 'zod';

import { GoalRunner } from '../browser/goal-runner';
import { bindWorkspaceActions } from '../browser/workspace-actions';
import { WorkspaceConnector } from '../browser/workspace-connector';
import { WorkspaceState } from '../browser/workspace-state';
import { journalVessel, tasksVessel } from '../vessels/definitions';
import { LocalWorkspaceHost } from './http-host';
import { MemoryWorkspaceRepository } from './workspace-repository';

const origin = 'http://127.0.0.1:4310';

test('outer storage failures emit bounded diagnostics without leaking causes or request data', async () => {
  const secret = 'private-token-and-record-content';
  const schemaFailure = z.string().safeParse({ content: secret });
  if (schemaFailure.success) throw new Error('Expected schema failure');
  const failures = [
    { cause: new SyntaxError(secret), category: 'invalid_stored_json' },
    { cause: schemaFailure.error, category: 'invalid_stored_schema' },
    {
      cause: new Error('Workspace authorization required.'),
      category: 'authorization_required',
    },
    { cause: new Error(secret.repeat(1_000)), category: 'storage_failure' },
  ];
  const logged = spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const [index, { cause, category }] of failures.entries()) {
      class FailedRepository extends MemoryWorkspaceRepository {
        override get(_token: string): never {
          throw cause;
        }
      }
      const host = new LocalWorkspaceHost(origin, {}, new FailedRepository());
      const response = await host.fetch(
        new Request(`${origin}/api/workspace/bootstrap?private=${secret}`, {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/json',
            cookie: `agui_local_workspace=${secret}`,
            'x-openai-key': secret,
          },
          body: JSON.stringify({ content: secret }),
        }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: 'STORAGE_UNAVAILABLE' },
      });
      expect(logged).toHaveBeenCalledTimes(index + 1);
      const line = logged.mock.calls.at(-1)?.[0];
      expect(typeof line).toBe('string');
      expect(line.length).toBeLessThan(256);
      expect(line).not.toContain(secret);
      expect(JSON.parse(line)).toEqual({
        event: 'workspace_storage_failed',
        operation: 'bootstrap',
        category,
        requestId: expect.any(String),
      });
    }
  } finally {
    logged.mockRestore();
  }
});

function latch() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function browser(host: LocalWorkspaceHost) {
  let cookie = '';
  let bindingId = '';
  return {
    setBinding(id: string) {
      bindingId = id;
    },
    async request(
      path: string,
      body: unknown,
      signal?: AbortSignal,
      headers?: HeadersInit,
    ) {
      const response = await host.fetch(
        new Request(`${origin}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            origin,
            cookie,
            'x-workspace-binding': bindingId,
            'x-openai-key': 'test-key-not-real',
            ...headers,
          },
          body: JSON.stringify(body),
          signal,
        }),
      );
      const next = response.headers.get('set-cookie');
      if (next) cookie = next.split(';')[0];
      return response;
    },
  };
}

test('authorized HTTP goals perform dependent writes through real canonical settlement', async () => {
  const adapter = Object.assign(fakeText(), {
    supportsCombinedToolsAndSchema: () => true,
  });
  let adapterRuns = 0;
  const host = new LocalWorkspaceHost(origin, {
    adapter: () => {
      adapterRuns++;
      adapter.setResponses(
        adapterRuns === 1
          ? [
              {
                toolCalls: [
                  {
                    id: 'create',
                    name: 'apply_workspace',
                    input: {
                      intent: 'Create a Journal entry.',
                      expectedMutation: {
                        kind: 'journal.create',
                        title: 'Notes',
                        date: '2026-11-07',
                      },
                    },
                  },
                ],
              },
            ]
          : adapterRuns === 2
            ? [
                {
                  toolCalls: [
                    { id: 'read', name: 'read_workspace', input: {} },
                  ],
                },
                ({ request }) => {
                  const message = [...request.messages]
                    .reverse()
                    .find(
                      (message) =>
                        message.role === 'tool' &&
                        message.toolCallId === 'read',
                    );
                  const state = JSON.parse(String(message?.content));
                  const entry = state.records.journal[0];
                  return {
                    toolCalls: [
                      {
                        id: 'append',
                        name: 'apply_workspace',
                        input: {
                          intent: `Append Hello to ${entry.id} version ${entry.version}.`,
                          expectedMutation: {
                            kind: 'journal.append',
                            target: { id: entry.id, version: entry.version },
                            text: 'Hello',
                          },
                        },
                      },
                    ],
                  };
                },
              ]
            : [
                {
                  text: JSON.stringify({
                    status: 'completed',
                    message: 'Created the entry and appended Hello.',
                  }),
                },
              ],
      );
      return adapter;
    },
    engine: (_key, records) =>
      createEngine({
        retry: false,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        planner: async ({ request }) => {
          for (const reason of request.context.updateReasons) {
            if (reason.type !== 'user_intent') continue;
            expect(reason).not.toHaveProperty('referents');
            expect(reason).not.toHaveProperty('id');
          }
          return ok(
            TilingResponseSchema.parse({
              type: 'plan',
              userMessage: 'Applied',
              rationale: 'HTTP integration fixture',
              layout: {
                tree: ['ID:journal-main'],
                instances: [
                  {
                    instanceId: 'journal-main',
                    vesselId: 'journal',
                    variant: 'entry',
                  },
                  {
                    instanceId: 'journal-retained',
                    vesselId: 'journal',
                    variant: 'list',
                  },
                ],
              },
              executionPlan: [
                {
                  instanceId: 'journal-main',
                  action: records.journal.length
                    ? 'writeContent'
                    : 'createEntry',
                  paramsJson: JSON.stringify(
                    records.journal.length
                      ? {
                          id: records.journal[0].id,
                          version: records.journal[0].version,
                          text: 'Hello',
                        }
                      : { title: 'Notes', date: '2026-11-07' },
                  ),
                },
              ],
            }),
          );
        },
      }),
  });
  const client = browser(host);
  const bootstrap = await (
    await client.request('/api/workspace/bootstrap', {})
  ).json();
  client.setBinding(bootstrap.bindingId);
  const connector = new WorkspaceConnector(async (input, signal) => {
    const frame = JSON.parse(input.frame);
    const operation = frame.input.forwardedProps;
    if (operation.kind === 'plan') {
      for (const reason of operation.message.request.context.updateReasons) {
        if (reason.type === 'user_intent') {
          reason.id = 'unissued-goal';
          reason.referents = { entryId: 'unissued-entry' };
        }
      }
    }
    const response = await client.request(
      '/api/workspace/exchange',
      { ...input, frame: JSON.stringify(frame) },
      signal,
    );
    if (!response.ok) throw new Error('Exchange rejected');
    return response.json();
  });
  const orchestrator = new Orchestrator(connector, {
    sessionId: SessionId(bootstrap.sessionId),
    vessels: [journalVessel],
  });
  orchestrator.commandProcessor.events.on('command_complete', ({ command }) => {
    if (command.kind !== 'set_layout') return;
    const write = (action: string) => async () => {
      const response = await client.request(
        '/api/workspace/operations',
        connector.claimAction('journal-main', action),
      );
      if (!response.ok) throw new Error('Write rejected');
      return ok(undefined);
    };
    orchestrator.commandProcessor.registerRunner(InstanceId('journal-main'), {
      createEntry: write('createEntry'),
      writeContent: write('writeContent'),
    });
  });
  try {
    await orchestrator.connect();
    const runner = new GoalRunner(
      bootstrap.threadId,
      client.request,
      connector,
      orchestrator,
    );
    const outcome = await runner.run(
      'Create a Journal entry and append Hello.',
    );
    expect(outcome).toMatchObject({
      status: 'completed',
      message: 'Created the entry and appended Hello.',
    });
    expect(outcome.applications).toHaveLength(2);
    expect(adapterRuns).toBe(3);
    const snapshot = await (
      await client.request('/api/workspace/records', {})
    ).json();
    expect(snapshot.records.journal).toMatchObject([
      { content: 'Hello', version: 2 },
    ]);
    expect(snapshot.application.status).toBe('applied');
    expect(snapshot.application.chart.instances).toHaveLength(1);
    expect(snapshot.observation.instances).toHaveLength(2);
    const stranger = browser(host);
    stranger.setBinding(bootstrap.bindingId);
    expect((await stranger.request('/api/workspace/records', {})).status).toBe(
      401,
    );
    const unrelated = await (
      await stranger.request('/api/workspace/bootstrap', {})
    ).json();
    expect(unrelated.records.journal).toEqual([]);
    expect(
      (
        await client.request('/api/workspace/records', {}, undefined, {
          origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
    const reload = await (
      await client.request('/api/workspace/bootstrap', {})
    ).json();
    expect(reload.needsReconciliation).toBe(true);
    expect(reload.records.journal[0].content).toBe('Hello');
    expect((await client.request('/api/workspace/records', {})).status).toBe(
      409,
    );
    const reconciled = await (
      await client.request('/api/workspace/bootstrap', { reconcile: true })
    ).json();
    expect(reconciled.sessionId).not.toBe(bootstrap.sessionId);
    expect(reconciled.records.journal[0].content).toBe('Hello');
    expect((await client.request('/api/workspace/records', {})).status).toBe(
      409,
    );
  } finally {
    await orchestrator.dispose();
  }
});

test('a refused append ends incomplete before a false model answer or replacement write can run', async () => {
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
            intent: 'Create Demo notes.',
            expectedMutation: {
              kind: 'journal.create',
              title: 'Demo notes',
              date: '2026-11-10',
            },
          },
        },
      ],
    },
    ({ request }) => {
      const result = request.messages.find(
        (message) => message.role === 'tool' && message.toolCallId === 'create',
      );
      const entry = JSON.parse(String(result?.content)).workspace.records
        .journal[0];
      return {
        toolCalls: [
          {
            id: 'append',
            name: 'apply_workspace',
            input: {
              intent: `Append Ready to record. to ${entry.id} version ${entry.version}.`,
              expectedMutation: {
                kind: 'journal.append',
                target: { id: entry.id, version: entry.version },
                text: 'Ready to record.',
              },
            },
          },
        ],
      };
    },
    {
      text: '{"status":"completed","message":"Created Demo notes and appended Ready to record."}',
    },
  ]);
  const host = new LocalWorkspaceHost(origin, {
    adapter: () => adapter,
    engine: (_key, records) =>
      createEngine({
        retry: false,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        planner: async () =>
          ok(
            TilingResponseSchema.parse({
              type: 'plan',
              userMessage: records.journal.length
                ? 'The record ID does not match. Append refused.'
                : 'Entry created.',
              rationale:
                'An accepted empty plan does not prove that the requested append happened.',
              layout: {
                tree: ['ID:journal'],
                instances: [
                  {
                    instanceId: 'journal',
                    vesselId: 'journal',
                    variant: 'entry',
                  },
                ],
              },
              executionPlan: records.journal.length
                ? []
                : [
                    {
                      instanceId: 'journal',
                      action: 'createEntry',
                      paramsJson: '{"title":"Demo notes","date":"2026-11-10"}',
                    },
                  ],
            }),
          ),
      }),
  });
  const client = browser(host);
  const bootstrap = await (
    await client.request('/api/workspace/bootstrap', {})
  ).json();
  client.setBinding(bootstrap.bindingId);
  const connector = new WorkspaceConnector(async (input, signal) => {
    const response = await client.request(
      '/api/workspace/exchange',
      input,
      signal,
    );
    if (!response.ok) throw new Error('Exchange rejected');
    return response.json();
  });
  const orchestrator = new Orchestrator(connector, {
    sessionId: SessionId(bootstrap.sessionId),
    vessels: [journalVessel],
  });
  const state = new WorkspaceState(
    bootstrap.records,
    connector,
    client.request,
  );
  const dispose = bindWorkspaceActions(orchestrator.commandProcessor, state);
  try {
    await orchestrator.connect();
    const runner = new GoalRunner(
      bootstrap.threadId,
      client.request,
      connector,
      orchestrator,
    );
    const outcome = await runner.run(
      'Create Demo notes and append Ready to record.',
    );
    expect(outcome.status).toBe('incomplete');
    expect(outcome.message).not.toContain('appended Ready to record.');
    expect(outcome.applications).toHaveLength(2);
    expect(adapter.state.callCount).toBe(2);
    expect(state.snapshot().records).toMatchObject({
      revision: 1,
      journal: [{ title: 'Demo notes', version: 1, content: '' }],
    });
    const snapshot = await (
      await client.request('/api/workspace/records', {})
    ).json();
    expect(snapshot.application).toMatchObject({
      status: 'applied',
      actions: [],
    });
    expect(snapshot.records).toEqual(state.snapshot().records);

    adapter.setResponses([
      {
        text: '{"status":"completed","message":"One empty Journal entry remains."}',
      },
    ]);
    expect(await runner.run('What remains saved?')).toMatchObject({
      status: 'completed',
      applications: [],
    });
    const review = await (
      await client.request('/api/workspace/bootstrap', {})
    ).json();
    expect(review.records).toEqual(snapshot.records);
    expect(
      review.operations.filter(
        (operation: { recordId?: string }) => operation.recordId,
      ),
    ).toHaveLength(1);
    const reconciled = await (
      await client.request('/api/workspace/bootstrap', { reconcile: true })
    ).json();
    expect(reconciled.records).toEqual(snapshot.records);
  } finally {
    dispose();
    state.dispose();
    await orchestrator.dispose();
  }
});

test('workspace reset deletes the records and revokes its cookie authorization', async () => {
  const client = browser(new LocalWorkspaceHost(origin));
  const first = await (
    await client.request('/api/workspace/bootstrap', {})
  ).json();
  client.setBinding(first.bindingId);
  const reset = await client.request('/api/workspace/reset', {});
  expect(reset.status).toBe(200);
  expect(reset.headers.get('set-cookie')).toContain('Max-Age=0');
  expect((await client.request('/api/workspace/records', {})).status).toBe(401);
  const second = await (
    await client.request('/api/workspace/bootstrap', {})
  ).json();
  expect(second.sessionId).not.toBe(first.sessionId);
});

test('a second tab keeps its binding and cookies when the first tab tries to reset', async () => {
  const client = browser(new LocalWorkspaceHost(origin));
  const open = async () =>
    z
      .object({ bindingId: z.string() })
      .parse(
        await (
          await client.request('/api/workspace/bootstrap', { reconcile: true })
        ).json(),
      );
  const first = await open();
  const review = await client.request('/api/workspace/bootstrap', {});
  const recovery = review.headers.get('x-workspace-recovery');
  const second = await open();
  const attempts: HeadersInit[] = [
    { 'x-workspace-binding': first.bindingId },
    { 'x-workspace-binding': '' },
    { 'x-workspace-recovery': recovery ?? '' },
  ];
  for (const headers of attempts) {
    const refused = await client.request(
      '/api/workspace/reset',
      {},
      undefined,
      headers,
    );
    expect(refused.status).toBe(409);
    expect(refused.headers.has('set-cookie')).toBe(false);
  }
  client.setBinding(second.bindingId);
  expect((await client.request('/api/workspace/records', {})).status).toBe(200);
  expect(recovery).toBeTruthy();
  const nextReview = await client.request('/api/workspace/bootstrap', {});
  client.setBinding('');
  const resetWith = (proof: string) =>
    client.request('/api/workspace/reset', {}, undefined, {
      'x-workspace-recovery': proof,
    });
  expect((await resetWith(recovery ?? '')).status).toBe(409);
  expect(
    (await resetWith(nextReview.headers.get('x-workspace-recovery') ?? ''))
      .status,
  ).toBe(200);
});

test('an expired review cannot authorize deletion until the owner inspects again', async () => {
  const client = browser(new LocalWorkspaceHost(origin));
  await client.request('/api/workspace/bootstrap', {});
  const getProof = async () => {
    const review = await client.request('/api/workspace/bootstrap', {});
    return z.string().min(1).parse(review.headers.get('x-workspace-recovery'));
  };
  const reset = (proof: string) =>
    client.request('/api/workspace/reset', {}, undefined, {
      'x-workspace-recovery': proof,
    });
  const now = Date.now();
  const clock = spyOn(Date, 'now').mockReturnValue(now);
  try {
    const proof = await getProof();
    clock.mockReturnValue(now + 5 * 60_000);
    expect((await reset(proof)).status).toBe(409);
    expect((await reset(await getProof())).status).toBe(200);
  } finally {
    clock.mockRestore();
  }
});

test('a retained hidden Task can commit once and supply its version to a dependent subtask', async () => {
  const adapter = Object.assign(fakeText(), {
    supportsCombinedToolsAndSchema: () => true,
  });
  adapter.setResponses([
    {
      toolCalls: [
        {
          id: 'hide',
          name: 'apply_workspace',
          input: { intent: 'Hide Tasks', expectedMutation: null },
        },
      ],
    },
    {
      toolCalls: [
        {
          id: 'create',
          name: 'apply_workspace',
          input: {
            intent: 'Create Task',
            expectedMutation: {
              kind: 'task.create',
              title: 'Verify isolation',
            },
          },
        },
      ],
    },
    ({ request }) => {
      const result = [...request.messages]
        .reverse()
        .find((message) => message.role === 'tool');
      const workspace = JSON.parse(String(result?.content)).workspace;
      expect(
        workspace.application.chart.instances.map(
          (instance: { vesselId: string }) => instance.vesselId,
        ),
      ).toEqual(['journal']);
      const task = workspace.records.tasks[0];
      return {
        toolCalls: [
          {
            id: 'append',
            name: 'apply_workspace',
            input: {
              intent: `Append to ${task.id} version ${task.version}`,
              expectedMutation: {
                kind: 'task.addSubtask',
                target: { id: task.id, version: task.version },
                title: 'Inspect receipt',
              },
            },
          },
        ],
      };
    },
    {
      text: JSON.stringify({
        status: 'completed',
        message: 'Task and subtask saved.',
      }),
    },
  ]);
  const task = { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' };
  const journal = {
    instanceId: 'journal-main',
    vesselId: 'journal',
    variant: 'list',
  };
  const host = new LocalWorkspaceHost(origin, {
    adapter: () => adapter,
    engine: (_key, records) =>
      createEngine({
        retry: false,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        planner: async (input) => {
          const reason = input.request.context.updateReasons.find(
            (reason) => reason.type === 'user_intent',
          );
          const intent = reason?.intent ?? '';
          return ok(
            TilingResponseSchema.parse({
              type: 'plan',
              userMessage: 'Apply retained Task',
              rationale: 'Retain hidden Instance identity',
              layout: {
                tree: [
                  intent.startsWith('Append')
                    ? 'ID:tasks-main'
                    : 'ID:journal-main',
                ],
                instances: [task, journal],
              },
              executionPlan:
                intent === 'Create Task'
                  ? [
                      {
                        instanceId: task.instanceId,
                        action: 'addTask',
                        paramsJson: JSON.stringify({
                          title: 'Verify isolation',
                        }),
                      },
                    ]
                  : intent.startsWith('Append')
                    ? [
                        {
                          instanceId: task.instanceId,
                          action: 'addSubtask',
                          paramsJson: JSON.stringify({
                            id: records.tasks[0].id,
                            version: records.tasks[0].version,
                            subtaskTitle: 'Inspect receipt',
                          }),
                        },
                      ]
                    : [],
            }),
          );
        },
      }),
  });
  const client = browser(host);
  const bootstrap = await (
    await client.request('/api/workspace/bootstrap', {})
  ).json();
  client.setBinding(bootstrap.bindingId);
  const connector = new WorkspaceConnector(async (input, signal) => {
    const response = await client.request(
      '/api/workspace/exchange',
      input,
      signal,
    );
    if (!response.ok) throw new Error('Exchange rejected');
    return response.json();
  });
  const orchestrator = new Orchestrator(connector, {
    sessionId: SessionId(bootstrap.sessionId),
    vessels: [tasksVessel, journalVessel],
  });
  const state = new WorkspaceState(
    bootstrap.records,
    connector,
    client.request,
  );
  const dispose = bindWorkspaceActions(orchestrator.commandProcessor, state);
  try {
    await orchestrator.connect();
    const runner = new GoalRunner(
      bootstrap.threadId,
      client.request,
      connector,
      orchestrator,
    );
    const outcome = await runner.run(
      'Hide Tasks, create a task, then add its subtask and show it.',
    );
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(outcome.applications).toHaveLength(3);
    expect(state.snapshot().records).toMatchObject({
      revision: 2,
      tasks: [
        {
          version: 2,
          title: 'Verify isolation',
          subtasks: [{ title: 'Inspect receipt' }],
        },
      ],
    });
    const snapshot = await (
      await client.request('/api/workspace/records', {})
    ).json();
    expect(snapshot.records).toEqual(state.snapshot().records);
    const review = await (
      await client.request('/api/workspace/bootstrap', {})
    ).json();
    expect(
      review.operations.filter(
        (operation: { recordId?: string }) => operation.recordId,
      ),
    ).toHaveLength(2);
  } finally {
    dispose();
    state.dispose();
    await orchestrator.dispose();
  }
});

test('a known limitation is incomplete, not completed or uncertain, and permits a later read-only goal', async () => {
  const adapter = Object.assign(fakeText(), {
    supportsCombinedToolsAndSchema: () => true,
  });
  adapter.setResponses([
    {
      toolCalls: [{ id: 'read-reference', name: 'read_workspace', input: {} }],
    },
    ({ request }) => {
      const result = request.messages.find(
        (message) =>
          message.role === 'tool' && message.toolCallId === 'read-reference',
      );
      const workspace = JSON.parse(String(result?.content));
      expect(workspace.records).toMatchObject({
        journal: [],
        tasks: [],
        calendar: [],
      });
      expect(
        workspace.referenceData.map.savedPlaces.map(
          (place: { name: string }) => place.name,
        ),
      ).toEqual([
        'Home',
        'Studio Vortex HQ',
        'Mission High Fitness',
        'Ritual Coffee',
      ]);
      return {
        text: '{"status":"incomplete","message":"No lab measurements are available."}',
      };
    },
    { text: '{"status":"completed","message":"There are no tasks."}' },
  ]);
  const client = browser(
    new LocalWorkspaceHost(origin, { adapter: () => adapter }),
  );
  const bootstrap = await (
    await client.request('/api/workspace/bootstrap', {})
  ).json();
  client.setBinding(bootstrap.bindingId);
  const connector = new WorkspaceConnector(async () => {
    throw new Error('Read-only goals must not submit UI operations');
  });
  const orchestrator = new Orchestrator(connector);
  const runner = new GoalRunner(
    bootstrap.threadId,
    client.request,
    connector,
    orchestrator,
  );
  try {
    expect(await runner.run('Show my actual lab results')).toMatchObject({
      status: 'incomplete',
      applications: [],
    });
    expect(await runner.run('How many tasks exist?')).toEqual({
      status: 'completed',
      message: 'There are no tasks.',
      applications: [],
    });
  } finally {
    await orchestrator.dispose();
  }
});

test('a late retired planner cannot stop the binding opened by explicit reconciliation', async () => {
  const entered = latch();
  const release = latch();
  let planners = 0;
  const host = new LocalWorkspaceHost(origin, {
    engine: () =>
      createEngine({
        retry: false,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        planner: async () => {
          if (++planners === 1) {
            entered.resolve();
            await release.promise;
          }
          return ok(
            TilingResponseSchema.parse({
              type: 'plan',
              userMessage: 'Journal shown',
              rationale: 'Fresh workspace',
              layout: {
                tree: ['ID:journal'],
                instances: [
                  {
                    instanceId: 'journal',
                    vesselId: 'journal',
                    variant: 'list',
                  },
                ],
              },
              executionPlan: [],
            }),
          );
        },
      }),
  });
  const client = browser(host);
  const first = await (
    await client.request('/api/workspace/bootstrap', {})
  ).json();
  client.setBinding(first.bindingId);
  const plan = (sessionId: string) => ({
    frame: JSON.stringify({
      type: WORKSPACE_RUN,
      input: workspaceRun(sessionId, {
        kind: 'plan',
        sequence: 1,
        revision: 0,
        message: ChartRequestMessage({
          sessionId: SessionId(sessionId),
          request: ChartRequestSchema.parse({
            type: 'chart_request',
            vessels: [],
            instances: [],
            layout: { type: 'tiling', tree: [], instances: [] },
            context: {
              updateReasons: [],
              chartDimensions: { rows: 12, columns: 12 },
              layoutMode: 'tiling',
            },
          }),
        }),
      }),
    }),
  });
  const old = client.request('/api/workspace/exchange', plan(first.sessionId));
  await entered.promise;
  const fresh = await (
    await client.request('/api/workspace/bootstrap', { reconcile: true })
  ).json();
  client.setBinding(fresh.bindingId);
  release.resolve();
  expect((await old).status).toBe(409);
  const current = await client.request(
    '/api/workspace/exchange',
    plan(fresh.sessionId),
  );
  expect(current.status).toBe(200);
  expect(await current.json()).toContainEqual(
    expect.objectContaining({ type: 'RUN_FINISHED' }),
  );
});
