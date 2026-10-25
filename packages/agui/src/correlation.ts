import type { WorkspaceCorrelation } from './contract.js';

export function sameCorrelation(
  left: WorkspaceCorrelation,
  right: WorkspaceCorrelation,
): boolean {
  return (
    left.threadId === right.threadId &&
    left.runId === right.runId &&
    left.requestId === right.requestId &&
    left.callId === right.callId &&
    left.revision === right.revision
  );
}
