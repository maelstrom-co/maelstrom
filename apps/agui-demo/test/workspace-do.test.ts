import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WORKSPACE_RUN, workspaceRun } from '@maelstrom-co/agui-protocol';
import { Orchestrator } from '@maelstrom-co/client';
import {
  ChartRequestMessage,
  ChartRequestSchema,
  SessionId,
} from '@maelstrom-co/protocol';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { z } from 'zod';

import { GoalRunner } from '../src/browser/goal-runner';
import { bindWorkspaceActions } from '../src/browser/workspace-actions';
import { WorkspaceConnector } from '../src/browser/workspace-connector';
import { WorkspaceState } from '../src/browser/workspace-state';
import type { Records } from '../src/records';
import { tasksVessel } from '../src/vessels/definitions';

interface Bootstrap {
  needsReconciliation: boolean;
  bindingId: string;
  sessionId: string;
  threadId: string;
  records: Records;
  operations: { requestId: string; status: string }[];
  storage: string;
}

let script: string;
beforeAll(async () => {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, 'workspace-fixture.ts')],
    target: 'browser',
    conditions: ['@maelstrom-co/source'],
    external: ['cloudflare:workers', 'node:*'],
  });
  if (!result.success)
    throw new AggregateError(result.logs, 'Worker bundle failed');
  script = await result.outputs[0].text();
});

const cleanup: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of cleanup) await close();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'agui-workerd-'));
  let port: number | undefined;
  const start = () =>
    new Miniflare(
      convertV4MiniflareOptions({
        name: 'agui-fixture',
        host: '127.0.0.1',
        port,
        modules: true,
        script,
        compatibilityDate: '2026-07-22',
        compatibilityFlags: ['nodejs_compat'],
        durableObjects: {
          WORKSPACES: { className: 'WorkspaceFixture', useSQLite: true },
        },
        resourcePersistencePath: directory,
      }),
    );
  let mf = start();
  const address = await mf.ready;
  port = Number(address.port);
  cleanup.push(async () => {
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  const origin = address.origin;
  const cookies = new Map<string, string>();
  let binding = '';
  const request = async (
    path: string,
    body: unknown = {},
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-workspace-binding': binding,
        'x-openai-key': 'fixture-key-must-not-persist',
        cookie: [...cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join('; '),
        ...headers,
      },
      body: JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [name, value] = cookie.split(';')[0].split('=');
      cookies.set(name, value);
    }
    return new Response(await response.text(), {
      status: response.status,
      headers: response.headers,
    });
  };
  return {
    request,
    async restart() {
      await mf.dispose();
      mf = start();
      await mf.ready;
    },
    async open(reconcile = false) {
      const response = await request('/api/workspace/bootstrap', { reconcile });
      expect(response.status).toBe(200);
      const result = (await response.json()) as Bootstrap;
      if (result.bindingId) binding = result.bindingId;
      return result;
    },
    async inspect(path = 'inspect') {
      const namespace = await mf.getDurableObjectNamespace('WORKSPACES');
      const stub = namespace.get(
        namespace.idFromName(`${origin}:${cookies.get('agui_local_route')}`),
      );
      const response = await stub.fetch(`${origin}/__fixture/${path}`);
      if (path !== 'inspect') {
        await response.text();
        return undefined;
      }
      return z
        .object({
          alarm: z.number().nullable(),
          access: z.array(z.unknown()),
          bindings: z.array(z.unknown()),
          records: z.array(z.unknown()),
          plans: z.array(z.unknown()),
        })
        .parse(await response.json());
    },
    async run(bootstrap: Bootstrap) {
      const browserRequest = async (path: string, body: unknown) => {
        const response = await request(path, body);
        return new Response(await response.text(), { status: response.status });
      };
      const connector = new WorkspaceConnector(async (input) => {
        const response = await request('/api/workspace/exchange', input);
        if (!response.ok) throw new Error('Exchange rejected');
        return z.array(z.unknown()).parse(await response.json());
      });
      const orchestrator = new Orchestrator(connector, {
        sessionId: SessionId(bootstrap.sessionId),
        vessels: [tasksVessel],
      });
      const state = new WorkspaceState(
        bootstrap.records,
        connector,
        browserRequest,
      );
      const dispose = bindWorkspaceActions(
        orchestrator.commandProcessor,
        state,
      );
      try {
        await orchestrator.connect();
        return await new GoalRunner(
          bootstrap.threadId,
          browserRequest,
          connector,
          orchestrator,
        ).run('Create a durable Task');
      } finally {
        dispose();
        state.dispose();
        await orchestrator.dispose();
      }
    },
    cookies,
  };
}

test('workerd restart preserves records and receipts, requires reconciliation, and fences the old browser', async () => {
  const f = await fixture();
  const first = await f.open();
  expect(first.storage).toBe('durable');
  expect((await f.run(first)).status).toBe('completed');
  const saved = await f.inspect();
  expect(JSON.stringify(saved)).not.toContain('fixture-key-must-not-persist');
  expect(saved?.alarm).toBeGreaterThan(Date.now());
  expect(saved?.plans).toHaveLength(1);
  await f.restart();
  expect((await f.request('/api/workspace/records')).status).toBe(409);
  const review = await f.open();
  expect(review.needsReconciliation).toBe(true);
  expect(review.records.tasks).toHaveLength(1);
  expect(review.operations[0].status).toBe('confirmed');
  const next = await f.open(true);
  expect(next.bindingId).not.toBe(first.bindingId);
  expect(next.sessionId).not.toBe(first.sessionId);
  expect(next.threadId).not.toBe(first.threadId);
  expect(
    (
      await f.request(
        '/api/workspace/records',
        {},
        { 'x-workspace-binding': first.bindingId },
      )
    ).status,
  ).toBe(409);
  const duplicate = await f.request('/api/workspace/operations', {
    requestId: review.operations[0].requestId,
    index: 0,
  });
  expect(duplicate.status).toBe(200);
  expect(((await duplicate.json()) as { records: unknown }).records).toEqual(
    review.records,
  );
}, 30_000);

test('a routing cookie cannot authorize reads or reset, and reset deletes the durable ledger', async () => {
  const f = await fixture();
  const initial = await f.open();
  await f.run(initial);
  for (const path of ['/api/workspace/records', '/api/workspace/reset']) {
    const response = await f.request(
      path,
      {},
      { cookie: `agui_local_route=${f.cookies.get('agui_local_route')}` },
    );
    expect(response.status).toBe(401);
  }
  expect(
    (
      await f.request(
        '/api/workspace/records',
        {},
        { origin: 'http://localhost' },
      )
    ).status,
  ).toBe(403);
  const route = f.cookies.get('agui_local_route');
  expect((await f.request('/api/workspace/reset')).status).toBe(200);
  f.cookies.set('agui_local_route', route ?? '');
  await f.restart();
  const stored = await f.inspect();
  expect(stored).toEqual({
    alarm: null,
    access: [],
    bindings: [],
    records: [],
    plans: [],
  });
}, 30_000);

test('workerd rolls back a record if its receipt fails and never replays that unresolved plan', async () => {
  const f = await fixture();
  const first = await f.open();
  await f.inspect('fail-receipt');
  expect((await f.run(first)).status).toBe('unknown');
  await f.restart();
  const review = await f.open();
  expect(review.records.tasks).toEqual([]);
  expect(review.operations[0].status).toBe('issued-unconfirmed');
  await f.open(true);
  expect(
    (
      await f.request('/api/workspace/operations', {
        requestId: review.operations[0].requestId,
        index: 0,
      })
    ).status,
  ).toBe(409);
}, 30_000);

test('the expiry alarm deletes records, receipts, authorization, and binding history', async () => {
  const f = await fixture();
  const first = await f.open();
  await f.run(first);
  await f.inspect('expire');
  await f.restart();
  await f.inspect('await-expiry');
  expect(await f.inspect()).toEqual({
    alarm: null,
    access: [],
    bindings: [],
    records: [],
    plans: [],
  });
  expect((await f.request('/api/workspace/records')).status).toBe(401);
}, 30_000);

test('a late workerd planner cannot publish into or stop a reconciled binding', async () => {
  const f = await fixture();
  const first = await f.open();
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
  await f.inspect('hold');
  const old = f.request('/api/workspace/exchange', plan(first.sessionId));
  await f.inspect('entered');
  const fresh = await f.open(true);
  await f.inspect('release');
  expect((await old).status).toBe(409);
  expect(
    (await f.request('/api/workspace/exchange', plan(fresh.sessionId))).status,
  ).toBe(200);
  const stored = await f.inspect();
  expect(stored?.plans).toHaveLength(1);
  expect(JSON.stringify(stored?.plans)).toContain(fresh.bindingId);
  expect(JSON.stringify(stored?.plans)).not.toContain(first.bindingId);
}, 30_000);
