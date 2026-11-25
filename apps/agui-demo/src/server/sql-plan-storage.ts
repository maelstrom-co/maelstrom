import { z } from 'zod';

import { emptyRecords, type Records, RecordsSchema } from '../records';
import type { IssuedPlan } from './issued-plans';
import { IssuedPlanSchema, type PlanStorage } from './plan-storage';

export interface WorkspaceDatabase {
  exec(query: string, ...bindings: (string | number)[]): Iterable<unknown>;
  transaction<T>(body: () => T): T;
}

const payloadRow = z.object({ payload: z.string() });
const maximumPlans = 256;
const maximumPayloadBytes = 1_048_576;

function encode(value: unknown) {
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > maximumPayloadBytes)
    throw new Error(
      'Workspace storage capacity reached. Inspect and reset the workspace.',
    );
  return encoded;
}

export class SqlPlanStorage implements PlanStorage {
  constructor(private readonly database: WorkspaceDatabase) {
    database.exec(`CREATE TABLE IF NOT EXISTS workspace_records (
      id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS issued_plans (
      ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL
    );`);
  }

  load(): ReturnType<PlanStorage['load']> {
    const rows = [
      ...this.database.exec(
        'SELECT payload FROM workspace_records WHERE id = 1',
      ),
    ];
    const records = rows.length
      ? RecordsSchema.parse(JSON.parse(payloadRow.parse(rows[0]).payload))
      : emptyRecords();
    const plans = [
      ...this.database.exec(
        'SELECT payload FROM issued_plans ORDER BY ordinal',
      ),
    ].map((row) =>
      IssuedPlanSchema.parse(JSON.parse(payloadRow.parse(row).payload)),
    );
    return { records, plans };
  }

  commit(plan: IssuedPlan, records?: Records) {
    const payload = encode(plan);
    const recordPayload = records ? encode(records) : undefined;
    this.database.transaction(() => {
      const existing = [
        ...this.database.exec(
          'SELECT request_id FROM issued_plans WHERE request_id = ?',
          plan.response.requestId,
        ),
      ];
      if (!existing.length) {
        const [row] = this.database.exec(
          'SELECT COUNT(*) AS count FROM issued_plans',
        );
        if (z.object({ count: z.number() }).parse(row).count >= maximumPlans)
          throw new Error(
            'Workspace plan capacity reached. Inspect and reset the workspace.',
          );
      }
      if (recordPayload !== undefined)
        this.database.exec(
          'INSERT INTO workspace_records (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
          recordPayload,
        );
      this.database.exec(
        'INSERT INTO issued_plans (request_id, payload) VALUES (?, ?) ON CONFLICT(request_id) DO UPDATE SET payload = excluded.payload',
        plan.response.requestId,
        payload,
      );
    });
  }
}
