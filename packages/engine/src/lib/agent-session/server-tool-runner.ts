import type { ServerToolContext } from './server-tool.js';
import type { ToolRegistryEntry } from './tool-registry.js';

/** Who a tool call runs on behalf of. Server Tools receive it only as `ctx.user` and `ctx.token`. */
export interface ToolCallIdentity {
  /** The user supplied when the connection opened. */
  readonly user: unknown;
  /** The credential the host forwarded with the connection, when there is one. */
  readonly token?: string;
}

/**
 * Runs a server-locus tool with already parsed input and returns its raw output.
 * This is the only place a {@link ServerToolContext} is built, so identity
 * reaches a tool through `ctx` and never through its arguments.
 */
export function runServerTool(
  entry: ToolRegistryEntry,
  input: unknown,
  identity: ToolCallIdentity,
  signal: AbortSignal,
): Promise<unknown> {
  const ctx: ServerToolContext =
    identity.token === undefined
      ? { user: identity.user, signal }
      : { user: identity.user, token: identity.token, signal };
  return entry.tool.execute(input as never, ctx);
}
