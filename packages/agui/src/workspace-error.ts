/** Machine-readable failure reasons for application-owned recovery UI. */
export type WorkspaceErrorCode =
  | 'connection_lost'
  | 'invalid_run'
  | 'run_failed'
  | 'run_timeout'
  | 'send_failed'
  | 'request_too_large'
  | 'planning_failed'
  | 'application_failed'
  | 'application_unknown';

/** A local, sanitized protocol failure; does not include remote error text. */
export class WorkspaceError extends Error {
  /** Stable failure reason independent of display wording. */
  readonly code: WorkspaceErrorCode;

  /** Create a protocol error without application-specific recovery instructions. */
  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}
