import { DurableObject } from 'cloudflare:workers';

import { LocalWorkspaceHost } from '../server/http-host';
import type { WorkspaceDatabase } from '../server/sql-plan-storage';
import { SqlWorkspaceRepository } from '../server/sql-workspace-repository';
import type { BindingDependencies } from '../server/workspace-binding';

export class WorkspaceDO extends DurableObject<Env> {
  private readonly database: WorkspaceDatabase;
  private host?: LocalWorkspaceHost;
  private repository?: SqlWorkspaceRepository;

  constructor(
    ctx: DurableObjectState,
    env: Env,
    private readonly dependencies: BindingDependencies = {},
  ) {
    super(ctx, env);
    this.database = {
      exec: (query, ...bindings) => ctx.storage.sql.exec(query, ...bindings),
      transaction: (body) => ctx.storage.transactionSync(body),
    };
    const exists = [
      ...ctx.storage.sql.exec(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace_access'",
      ),
    ].length;
    if (exists) {
      const [saved] = ctx.storage.sql.exec<{ origin: string }>(
        'SELECT origin FROM workspace_access WHERE id = 1',
      );
      if (saved) this.open(saved.origin);
    }
  }

  private open(origin: string) {
    this.repository = new SqlWorkspaceRepository(this.database, origin);
    this.host = new LocalWorkspaceHost(
      origin,
      this.dependencies,
      this.repository,
    );
  }

  private async scheduleExpiry() {
    const expiry = this.repository?.expiresAt();
    if (expiry === undefined) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(expiry);
  }

  override async fetch(request: Request): Promise<Response> {
    if (!this.host) this.open(new URL(request.url).origin);
    try {
      if (!this.host) throw new Error('Workspace host unavailable.');
      return await this.host.fetch(request);
    } finally {
      // Output gates keep the response behind both the SQL writes and alarm persistence.
      await this.scheduleExpiry();
    }
  }

  override async alarm() {
    this.repository?.expire();
    await this.scheduleExpiry();
  }
}
