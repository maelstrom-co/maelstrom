import { IssuedPlans } from './issued-plans';
import type { WorkspaceBinding } from './workspace-binding';

export interface StoredWorkspace {
  plans: IssuedPlans;
  binding?: WorkspaceBinding;
  needsReconciliation: boolean;
}

export interface ResetBinding {
  id: string;
  active: boolean;
}

export interface WorkspaceRepository {
  readonly storage: 'memory' | 'durable';
  get(token: string): StoredWorkspace | undefined;
  create(token: string): StoredWorkspace;
  bind(workspace: StoredWorkspace, binding: WorkspaceBinding): void;
  retire(workspace: StoredWorkspace): void;
  touch(workspace: StoredWorkspace): void;
  resetBinding(token: string): ResetBinding | undefined;
  delete(
    token: string,
    permits: (binding: ResetBinding) => boolean,
  ): 'unauthorized' | 'retired' | 'deleted';
}

export class MemoryWorkspaceRepository implements WorkspaceRepository {
  readonly storage = 'memory';
  private readonly workspaces = new Map<string, StoredWorkspace>();

  get(token: string) {
    return this.workspaces.get(token);
  }
  create(token: string) {
    if (this.workspaces.size >= 100)
      throw new Error('Local workspace capacity reached.');
    const workspace = { plans: new IssuedPlans(), needsReconciliation: false };
    this.workspaces.set(token, workspace);
    return workspace;
  }
  bind(workspace: StoredWorkspace, binding: WorkspaceBinding) {
    workspace.plans.reconcile(binding.id);
    workspace.binding = binding;
    workspace.needsReconciliation = true;
  }
  touch(_workspace: StoredWorkspace) {}
  retire(workspace: StoredWorkspace) {
    workspace.binding?.stop();
    workspace.plans.stop();
  }
  resetBinding(token: string) {
    const binding = this.workspaces.get(token)?.binding;
    return (
      binding && { id: binding.id, active: !binding.lifetime.signal.aborted }
    );
  }
  delete(token: string, permits: (binding: ResetBinding) => boolean) {
    const workspace = this.workspaces.get(token);
    const binding = this.resetBinding(token);
    if (!workspace || !binding) return 'unauthorized';
    if (!permits(binding)) return 'retired';
    this.retire(workspace);
    this.workspaces.delete(token);
    return 'deleted';
  }
}
