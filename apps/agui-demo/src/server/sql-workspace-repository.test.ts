import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import {
  ChartRequestSchema,
  MaelstromResponseMessageSchema,
} from '@maelstrom-co/protocol';

import { tasksVessel } from '../vessels/definitions';
import { LocalWorkspaceHost } from './http-host';
import type { WorkspaceDatabase } from './sql-plan-storage';
import {
  SqlWorkspaceRepository,
  workspaceRetentionMs,
} from './sql-workspace-repository';

const origin = 'https://workspace.example';
function fixture() {
  const db = new Database(':memory:');
  let failBinding = false;
  const driver: WorkspaceDatabase = {
    exec(query, ...bindings) {
      if (failBinding && query.startsWith('INSERT INTO workspace_bindings')) {
        failBinding = false;
        throw new Error('Binding storage unavailable');
      }
      if (query.startsWith('CREATE TABLE')) {
        db.exec(query);
        return [];
      }
      return db.query(query).all(...bindings);
    },
    transaction: (body) => db.transaction(body)(),
  };
  let now = 1_000_000;
  let repository = new SqlWorkspaceRepository(driver, origin, () => now);
  let host = new LocalWorkspaceHost(origin, {}, repository);
  let cookie = '';
  let binding = '';
  return {
    db,
    failNextBinding() {
      failBinding = true;
    },
    get repository() {
      return repository;
    },
    get token() {
      return cookie.split('=')[1];
    },
    advance(ms: number) {
      now += ms;
    },
    restart() {
      repository = new SqlWorkspaceRepository(driver, origin, () => now);
      host = new LocalWorkspaceHost(origin, {}, repository);
    },
    async request(
      path: string,
      body: unknown = {},
      headers?: Record<string, string>,
    ) {
      const response = await host.fetch(
        new Request(`${origin}${path}`, {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/json',
            cookie,
            'x-workspace-binding': binding,
            ...headers,
          },
          body: JSON.stringify(body),
        }),
      );
      const next = response.headers.get('set-cookie');
      if (next) cookie = next.split(';')[0];
      return response;
    },
    async open(reconcile = false) {
      const response = await this.request('/api/workspace/bootstrap', {
        reconcile,
      });
      expect(response.status).toBe(200);
      const result = await response.json();
      if (result.bindingId) binding = result.bindingId;
      return result;
    },
    issue(id = 'create-task') {
      const workspace = repository.get(this.token);
      if (!workspace) throw new Error('Missing authorized workspace');
      const request = ChartRequestSchema.parse({
        type: 'chart_request',
        context: {
          updateReasons: [{ type: 'user_intent', intent: 'Create Task' }],
          chartDimensions: { rows: 10, columns: 20 },
          layoutMode: 'tiling',
        },
        vessels: [tasksVessel],
        instances: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      });
      const response = MaelstromResponseMessageSchema.parse({
        type: 'engine.maelstrom.response',
        requestId: id,
        response: {
          type: 'maelstrom_response',
          requestId: id,
          userMessage: '',
          rationale: '',
          executionPlan: [
            {
              instanceId: 'tasks',
              action: 'addTask',
              params: { title: 'Durable Task' },
            },
          ],
          layout: {
            type: 'tiling',
            tree: ['ID:tasks'],
            instances: [
              { instanceId: 'tasks', vesselId: 'tasks', variant: 'list' },
            ],
          },
        },
      }).response;
      workspace.plans.issue(response, request, {
        id: 'tool',
        intent: 'Create Task',
      });
    },
  };
}

test('failed first bootstrap releases retained routing authorization after five minutes', async () => {
  const f = fixture();
  try {
    f.failNextBinding();
    const failed = await f.request('/api/workspace/bootstrap');
    expect(failed.status).toBe(503);
    expect(failed.headers.get('set-cookie')).toBeNull();
    expect(f.repository.expiresAt()).toBe(1_000_000 + 5 * 60_000);
    f.restart();
    f.advance(5 * 60_000 - 1);
    expect((await f.request('/api/workspace/bootstrap')).status).toBe(503);
    f.advance(1);
    const opened = await f.open();
    expect(opened.needsReconciliation).toBe(false);
    expect(f.repository.expiresAt()).toBe(
      1_000_000 + 5 * 60_000 + workspaceRetentionMs,
    );
  } finally {
    f.db.close();
  }
});

test('never-bound authorization cannot reset the workspace or extend its provisional lifetime', async () => {
  const f = fixture();
  try {
    const workspace = f.repository.create('provisional-token');
    const expiry = f.repository.expiresAt();
    f.advance(60_000);
    f.repository.touch(workspace);
    const refused = await f.request(
      '/api/workspace/reset',
      {},
      {
        cookie: '__Host-agui_workspace=provisional-token',
      },
    );
    expect(refused.status).toBe(401);
    expect(f.repository.expiresAt()).toBe(expiry);
    f.advance(4 * 60_000);
    expect(f.repository.get('provisional-token')).toBeUndefined();
  } finally {
    f.db.close();
  }
});

test('failed rebind keeps committed records and receipts for seven days', async () => {
  const f = fixture();
  try {
    await f.open();
    f.issue();
    const receipt = await (
      await f.request('/api/workspace/operations', {
        requestId: 'create-task',
        index: 0,
      })
    ).json();
    f.restart();
    f.advance(60_000);
    f.failNextBinding();
    expect(
      (await f.request('/api/workspace/bootstrap', { reconcile: true })).status,
    ).toBe(503);
    expect(f.repository.expiresAt()).toBe(1_060_000 + workspaceRetentionMs);
    f.advance(5 * 60_000);
    f.restart();
    const review = await f.open();
    expect(review.records).toEqual(receipt.records);
    expect(review.operations).toMatchObject([
      { status: 'committed-unconfirmed', recordId: receipt.recordId },
    ]);
  } finally {
    f.db.close();
  }
});

test('restart requires reconciliation, preserves a committed receipt, and rejects the retired browser binding', async () => {
  const f = fixture();
  try {
    const first = await f.open();
    f.issue();
    const write = await f.request('/api/workspace/operations', {
      requestId: 'create-task',
      index: 0,
    });
    expect(write.status).toBe(200);
    const receipt = await write.json();
    f.restart();
    expect((await f.request('/api/workspace/records')).status).toBe(409);
    const review = await f.open();
    expect(review).toMatchObject({
      needsReconciliation: true,
      storage: 'durable',
      records: receipt.records,
      operations: [
        { status: 'committed-unconfirmed', recordId: receipt.recordId },
      ],
    });
    const second = await f.open(true);
    expect(second.bindingId).not.toBe(first.bindingId);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.threadId).not.toBe(first.threadId);
    const staleReset = await f.request(
      '/api/workspace/reset',
      {},
      {
        'x-workspace-binding': first.bindingId,
      },
    );
    expect(staleReset.status).toBe(409);
    expect(staleReset.headers.has('set-cookie')).toBe(false);
    expect(
      (
        await f.request(
          '/api/workspace/operations',
          { requestId: 'create-task', index: 0 },
          { 'x-workspace-binding': first.bindingId },
        )
      ).status,
    ).toBe(409);
    const duplicate = await f.request('/api/workspace/operations', {
      requestId: 'create-task',
      index: 0,
    });
    expect(await duplicate.json()).toEqual(receipt);
    expect(f.repository.get(f.token)?.plans.snapshot().tasks).toHaveLength(1);
    const rows = f.db
      .query('SELECT id, retired_at FROM workspace_bindings ORDER BY rowid')
      .all();
    expect(rows).toMatchObject([
      { id: first.bindingId, retired_at: expect.any(Number) },
      { id: second.bindingId, retired_at: null },
    ]);
    const saved = f.db
      .query<{ payload: string }, []>('SELECT payload FROM issued_plans')
      .get();
    expect(JSON.parse(saved?.payload ?? '{}').bindingId).toBe(first.bindingId);
  } finally {
    f.db.close();
  }
});

test('knowing a routing identity or binding does not authorize reading or resetting another workspace', async () => {
  const f = fixture();
  try {
    const first = await f.open();
    f.issue();
    await f.request('/api/workspace/operations', {
      requestId: 'create-task',
      index: 0,
    });
    for (const path of ['/api/workspace/records', '/api/workspace/reset']) {
      const response = await f.request(
        path,
        {},
        {
          cookie: '__Host-agui_workspace=wrong-secret',
          'x-workspace-binding': first.bindingId,
        },
      );
      expect(response.status).toBe(401);
    }
    expect(
      (
        await f.request(
          '/api/workspace/records',
          {},
          { origin: 'https://other.example' },
        )
      ).status,
    ).toBe(403);
    expect(f.repository.get(f.token)?.plans.snapshot().tasks).toHaveLength(1);
    const access = f.db.query('SELECT * FROM workspace_access').get();
    expect(JSON.stringify(access)).not.toContain(f.token);
  } finally {
    f.db.close();
  }
});

test('seven-day retention slides after authorized use and expires records and receipts without replay', async () => {
  const f = fixture();
  try {
    await f.open();
    f.issue();
    await f.request('/api/workspace/operations', {
      requestId: 'create-task',
      index: 0,
    });
    const oldExpiry = f.repository.expiresAt();
    f.advance(workspaceRetentionMs - 1);
    const used = await f.request('/api/workspace/records');
    expect(used.status).toBe(200);
    expect(used.headers.get('set-cookie')).toContain('Max-Age=604800');
    expect(f.repository.expiresAt()).toBe(
      (oldExpiry ?? 0) + workspaceRetentionMs - 1,
    );
    f.advance(workspaceRetentionMs);
    f.repository.expire();
    expect((await f.request('/api/workspace/records')).status).toBe(401);
    for (const table of [
      'workspace_access',
      'workspace_bindings',
      'workspace_records',
      'issued_plans',
    ])
      expect(
        f.db.query(`SELECT COUNT(*) AS count FROM ${table}`).get(),
      ).toEqual({ count: 0 });
  } finally {
    f.db.close();
  }
});

test('reset deletes durable records, receipts, authorization, and binding history', async () => {
  const f = fixture();
  try {
    const first = await f.open();
    const token = f.token;
    const active = f.repository.get(token)?.binding;
    f.issue();
    await f.request('/api/workspace/operations', {
      requestId: 'create-task',
      index: 0,
    });
    const reset = await f.request('/api/workspace/reset');
    expect(reset.status).toBe(200);
    expect(active?.lifetime.signal.aborted).toBe(true);
    expect(reset.headers.get('set-cookie')).toContain('Max-Age=0');
    f.restart();
    expect(f.repository.get(token)).toBeUndefined();
    for (const table of [
      'workspace_access',
      'workspace_bindings',
      'workspace_records',
      'issued_plans',
    ])
      expect(
        f.db.query(`SELECT COUNT(*) AS count FROM ${table}`).get(),
      ).toEqual({ count: 0 });
    const next = await f.open();
    expect(next.needsReconciliation).toBe(false);
    expect(next.records.tasks).toEqual([]);
    expect(next.bindingId).not.toBe(first.bindingId);
  } finally {
    f.db.close();
  }
});

for (const table of ['workspace_records', 'issued_plans']) {
  test(`authenticated reset recovers cold corrupt ${table} without decoding it`, async () => {
    const f = fixture();
    try {
      await f.open();
      const token = f.token;
      f.issue();
      await f.request('/api/workspace/operations', {
        requestId: 'create-task',
        index: 0,
      });
      f.db.query(`UPDATE ${table} SET payload = ?`).run('invalid JSON');
      f.restart();
      const failed = await f.request('/api/workspace/bootstrap');
      expect(failed.status).toBe(503);
      const recovery = failed.headers.get('x-workspace-recovery');
      const expiry = f.repository.expiresAt();
      const refused = await f.request(
        '/api/workspace/reset',
        {},
        {
          cookie: '__Host-agui_workspace=wrong-secret',
        },
      );
      expect(refused.status).toBe(401);
      expect(f.repository.expiresAt()).toBe(expiry);
      expect(f.db.query(`SELECT payload FROM ${table}`).get()).toEqual({
        payload: 'invalid JSON',
      });
      expect((await f.request('/api/workspace/reset')).status).toBe(409);
      expect(recovery).toBeTruthy();
      f.restart();
      const reset = await f.request(
        '/api/workspace/reset',
        {},
        {
          'x-workspace-binding': '',
          'x-workspace-recovery': recovery ?? '',
        },
      );
      expect(reset.status).toBe(200);
      expect(reset.headers.get('set-cookie')).toContain('Max-Age=0');
      for (const name of [
        'workspace_access',
        'workspace_bindings',
        'workspace_records',
        'issued_plans',
      ]) {
        expect(
          f.db.query(`SELECT COUNT(*) AS count FROM ${name}`).get(),
        ).toEqual({ count: 0 });
      }
      f.restart();
      expect(f.repository.get(token)).toBeUndefined();
      expect((await f.open()).records.tasks).toEqual([]);
    } finally {
      f.db.close();
    }
  });
}
