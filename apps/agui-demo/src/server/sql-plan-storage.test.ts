import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkspaceApplicationSchema } from '@maelstrom-co/agui-protocol';
import {
  ChartRequestSchema,
  MaelstromResponseMessageSchema,
} from '@maelstrom-co/protocol';

import { journalVessel } from '../vessels/definitions';
import { IssuedPlans } from './issued-plans';
import { SqlPlanStorage, type WorkspaceDatabase } from './sql-plan-storage';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

function database(path: string) {
  const db = new Database(path);
  let failPlanWrite = false;
  const driver: WorkspaceDatabase = {
    exec(query, ...bindings) {
      if (failPlanWrite && query.startsWith('INSERT INTO issued_plans'))
        throw new Error('Injected disk failure');
      if (query.startsWith('CREATE TABLE')) {
        db.exec(query);
        return [];
      }
      return db.query(query).all(...bindings);
    },
    transaction: (body) => db.transaction(body)(),
  };
  return {
    db,
    driver,
    storage: new SqlPlanStorage(driver),
    fail: () => {
      failPlanWrite = true;
    },
  };
}

function file() {
  const folder = mkdtempSync(join(tmpdir(), 'agui-ledger-'));
  folders.push(folder);
  return join(folder, 'workspace.sqlite');
}

const request = ChartRequestSchema.parse({
  type: 'chart_request',
  context: {
    updateReasons: [{ type: 'user_intent', intent: 'Create note' }],
    chartDimensions: { rows: 10, columns: 20 },
    layoutMode: 'tiling',
  },
  vessels: [journalVessel],
  instances: [],
  layout: { type: 'tiling', tree: [], instances: [] },
});
const tool = { id: 'create-tool', intent: 'Create note' };
function response(id = 'create-request') {
  return MaelstromResponseMessageSchema.parse({
    type: 'engine.maelstrom.response',
    requestId: id,
    response: {
      type: 'maelstrom_response',
      requestId: id,
      userMessage: 'Create note',
      rationale: 'Durability fixture',
      layout: {
        type: 'tiling',
        tree: ['ID:journal'],
        instances: [
          { instanceId: 'journal', vesselId: 'journal', variant: 'entry' },
        ],
      },
      executionPlan: [
        {
          instanceId: 'journal',
          action: 'createEntry',
          params: { title: 'One durable note', date: '2026-11-09' },
        },
      ],
    },
  }).response;
}

test('a lost write response returns the same durable receipt after restart without creating a second record', () => {
  const path = file();
  const first = database(path);
  const plans = new IssuedPlans(first.storage);
  plans.reconcile();
  plans.issue(response(), request, tool);
  const receipt = plans.execute('create-request', 0);
  first.db.close();
  const second = database(path);
  try {
    const recovered = new IssuedPlans(second.storage);
    expect(recovered.execute('create-request', 0)).toEqual(receipt);
    expect(recovered.snapshot()).toEqual(receipt.records);
    expect(recovered.review()).toMatchObject([
      { status: 'committed-unconfirmed', recordId: receipt.recordId },
    ]);
    expect(() => recovered.issue(response('next'), request, tool)).toThrow(
      'cannot be issued',
    );
    recovered.reconcile();
    expect(recovered.execute('create-request', 0)).toEqual(receipt);
    expect(recovered.snapshot().journal).toHaveLength(1);
    expect(second.storage.load().plans[0]).toMatchObject({
      request,
      response: response(),
      effect: { index: 0 },
      receipt,
    });
  } finally {
    second.db.close();
  }
});

test('an issued but unexecuted plan cannot replay after restart or explicit reconciliation', () => {
  const path = file();
  const first = database(path);
  const plans = new IssuedPlans(first.storage);
  plans.reconcile();
  plans.issue(response(), request, tool);
  first.db.close();
  const second = database(path);
  try {
    const recovered = new IssuedPlans(second.storage);
    expect(() => recovered.execute('create-request', 0)).toThrow('not issued');
    recovered.reconcile();
    expect(() => recovered.execute('create-request', 0)).toThrow('not issued');
    expect(recovered.snapshot().journal).toEqual([]);
    expect(recovered.review()).toMatchObject([
      { status: 'issued-unconfirmed' },
    ]);
  } finally {
    second.db.close();
  }
});

test('receipt write failure rolls back the record mutation and stops new work', () => {
  const path = file();
  const first = database(path);
  const plans = new IssuedPlans(first.storage);
  plans.reconcile();
  plans.issue(response(), request, tool);
  first.fail();
  expect(() => plans.execute('create-request', 0)).toThrow(
    'Injected disk failure',
  );
  expect(plans.snapshot().journal).toEqual([]);
  expect(() => plans.execute('create-request', 0)).toThrow('not issued');
  first.db.close();
  const second = database(path);
  try {
    const recovered = new IssuedPlans(second.storage);
    expect(recovered.snapshot().journal).toEqual([]);
    expect(recovered.review()).toMatchObject([
      { status: 'issued-unconfirmed' },
    ]);
  } finally {
    second.db.close();
  }
});

test('plan persistence failure prevents issuance before an Action can be claimed', () => {
  const saved = database(file());
  try {
    const plans = new IssuedPlans(saved.storage);
    plans.reconcile();
    saved.fail();
    expect(() => plans.issue(response(), request, tool)).toThrow(
      'Injected disk failure',
    );
    expect(plans.review()).toEqual([]);
    expect(() => plans.execute('create-request', 0)).toThrow('not issued');
    expect(saved.storage.load().plans).toEqual([]);
  } finally {
    saved.db.close();
  }
});

function evidence() {
  const layout = response().layout;
  if (layout?.type !== 'tiling') throw new Error('Expected tiling fixture');
  const observation = ChartRequestSchema.parse({
    ...request,
    context: { ...request.context, updateReasons: [] },
    instances: layout.instances,
    layout,
  });
  const application = WorkspaceApplicationSchema.parse({
    correlation: {
      threadId: 'thread',
      runId: 'run',
      requestId: 'create-request',
      callId: 'call',
      revision: 0,
    },
    status: 'applied',
    actions: [
      { instanceId: 'journal', action: 'createEntry', succeeded: true },
    ],
    chart: {
      instances: observation.instances,
      layout: observation.layout,
      layoutMode: 'tiling',
      chartDimensions: observation.context.chartDimensions,
    },
  });
  return { application, observation };
}

test('only durable accepted evidence can confirm a frontend tool after a restart', () => {
  const path = file();
  const first = database(path);
  const plans = new IssuedPlans(first.storage);
  const proof = evidence();
  plans.reconcile();
  plans.issue(response(), request, tool);
  plans.execute('create-request', 0);
  plans.accept(proof.application, proof.observation, tool.id);
  first.db.close();
  const second = database(path);
  try {
    const recovered = new IssuedPlans(second.storage);
    expect(() => recovered.confirmed('create-request', tool.id)).toThrow(
      'not confirmed',
    );
    recovered.reconcile();
    expect(recovered.confirmed('create-request', tool.id).accepted).toEqual(
      proof,
    );
    expect(recovered.review()).toMatchObject([{ status: 'confirmed' }]);
  } finally {
    second.db.close();
  }
});

test('a failed evidence commit cannot publish confirmation even when the record was saved', () => {
  const path = file();
  const first = database(path);
  const plans = new IssuedPlans(first.storage);
  const proof = evidence();
  plans.reconcile();
  plans.issue(response(), request, tool);
  plans.execute('create-request', 0);
  first.fail();
  expect(() =>
    plans.accept(proof.application, proof.observation, tool.id),
  ).toThrow('Injected disk failure');
  expect(() => plans.confirmed('create-request', tool.id)).toThrow(
    'not confirmed',
  );
  first.db.close();
  const second = database(path);
  try {
    const recovered = new IssuedPlans(second.storage);
    recovered.reconcile();
    expect(() => recovered.confirmed('create-request', tool.id)).toThrow(
      'not confirmed',
    );
    expect(recovered.review()).toMatchObject([
      { status: 'committed-unconfirmed' },
    ]);
    expect(recovered.snapshot().journal).toHaveLength(1);
  } finally {
    second.db.close();
  }
});
