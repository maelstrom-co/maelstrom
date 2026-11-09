import { createHash, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { IssuedPlans } from './issued-plans';
import { SqlPlanStorage, type WorkspaceDatabase } from './sql-plan-storage';
import type { WorkspaceBinding } from './workspace-binding';
import type {
  StoredWorkspace,
  WorkspaceRepository,
} from './workspace-repository';

export const workspaceRetentionMs = 7 * 24 * 60 * 60 * 1_000;
const metadata = z.object({
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
  origin: z.string(),
  expires_at: z.number().int(),
  binding_id: z.string().nullable(),
});

export class SqlWorkspaceRepository implements WorkspaceRepository {
  readonly storage = 'durable';
  private readonly plans: SqlPlanStorage;
  private workspace?: StoredWorkspace;

  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly origin: string,
    private readonly now = Date.now,
  ) {
    this.plans = new SqlPlanStorage(database);
    database.exec(`CREATE TABLE IF NOT EXISTS workspace_access (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      token_hash TEXT NOT NULL, origin TEXT NOT NULL,
      expires_at INTEGER NOT NULL, binding_id TEXT
    );
    CREATE TABLE IF NOT EXISTS workspace_bindings (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, thread_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, retired_at INTEGER
    );`);
    database.exec(
      'UPDATE workspace_bindings SET retired_at = ? WHERE retired_at IS NULL',
      now(),
    );
  }

  private metadata() {
    const rows = [
      ...this.database.exec(
        'SELECT token_hash, origin, expires_at, binding_id FROM workspace_access WHERE id = 1',
      ),
    ];
    return rows.length ? metadata.parse(rows[0]) : undefined;
  }

  expiresAt() {
    return this.metadata()?.expires_at;
  }

  expire() {
    const expiresAt = this.expiresAt();
    if (expiresAt !== undefined && expiresAt <= this.now()) this.clear();
  }

  private clear() {
    this.workspace?.binding?.stop();
    this.workspace?.plans.stop();
    this.database.transaction(() => {
      this.database.exec('DELETE FROM workspace_access');
      this.database.exec('DELETE FROM workspace_bindings');
      this.database.exec('DELETE FROM workspace_records');
      this.database.exec('DELETE FROM issued_plans');
    });
    this.workspace = undefined;
  }

  get(token: string) {
    this.expire();
    const saved = this.metadata();
    if (!saved || saved.origin !== this.origin) return undefined;
    const expected = Buffer.from(saved.token_hash, 'hex');
    const provided = createHash('sha256').update(token).digest();
    if (!timingSafeEqual(provided, expected)) return undefined;
    this.workspace ??= {
      plans: new IssuedPlans(this.plans),
      needsReconciliation: saved.binding_id !== null,
    };
    return this.workspace;
  }

  create(token: string) {
    this.expire();
    if (this.metadata()) throw new Error('Workspace authorization required.');
    this.database.exec(
      'INSERT INTO workspace_access (id, token_hash, origin, expires_at) VALUES (1, ?, ?, ?)',
      createHash('sha256').update(token).digest('hex'),
      this.origin,
      this.now() + workspaceRetentionMs,
    );
    this.workspace = {
      plans: new IssuedPlans(this.plans),
      needsReconciliation: false,
    };
    return this.workspace;
  }

  bind(workspace: StoredWorkspace, binding: WorkspaceBinding) {
    this.assertCurrent(workspace);
    const now = this.now();
    this.database.transaction(() => {
      this.database.exec(
        'UPDATE workspace_bindings SET retired_at = ? WHERE retired_at IS NULL',
        now,
      );
      this.database.exec(
        'INSERT INTO workspace_bindings (id, session_id, thread_id, created_at) VALUES (?, ?, ?, ?)',
        binding.id,
        binding.sessionId,
        binding.threadId,
        now,
      );
      this.database.exec(
        'UPDATE workspace_access SET binding_id = ?, expires_at = ? WHERE id = 1',
        binding.id,
        now + workspaceRetentionMs,
      );
    });
    workspace.plans.reconcile(binding.id);
    workspace.binding = binding;
    workspace.needsReconciliation = true;
  }

  touch(workspace: StoredWorkspace) {
    this.assertCurrent(workspace);
    this.database.exec(
      'UPDATE workspace_access SET expires_at = ? WHERE id = 1',
      this.now() + workspaceRetentionMs,
    );
  }

  retire(workspace: StoredWorkspace) {
    workspace.binding?.stop();
    workspace.plans.stop();
    this.assertCurrent(workspace);
    this.database.exec(
      'UPDATE workspace_bindings SET retired_at = ? WHERE retired_at IS NULL',
      this.now(),
    );
  }

  delete(token: string) {
    if (!this.get(token)) throw new Error('Workspace authorization required.');
    this.clear();
  }

  private assertCurrent(workspace: StoredWorkspace) {
    this.expire();
    if (workspace !== this.workspace || !this.metadata())
      throw new Error('Workspace has retired.');
  }
}
