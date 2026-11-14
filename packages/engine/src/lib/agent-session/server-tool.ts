import type { JsonValue } from '@maelstrom-co/protocol';
import type { z } from 'zod';

/** Every allowed {@link ToolLocus}. */
export const TOOL_LOCI = ['server'] as const;

/** Every allowed {@link ToolSideEffect}. */
export const TOOL_SIDE_EFFECTS = [
  'read_only',
  'idempotent',
  'non_idempotent',
] as const;

/** Every allowed {@link ToolApproval}. */
export const TOOL_APPROVALS = ['never'] as const;

/** Where a tool runs. Only `server` exists today. */
export type ToolLocus = (typeof TOOL_LOCI)[number];

/** How a tool affects the world, used to decide whether repeating or parallelizing it is safe. */
export type ToolSideEffect = (typeof TOOL_SIDE_EFFECTS)[number];

/** Whether a call needs user approval before it runs. Only `never` exists today. */
export type ToolApproval = (typeof TOOL_APPROVALS)[number];

/** Per-call context handed to a Server Tool. Identity reaches tools only through this object. */
export interface ServerToolContext {
  /** The user supplied when the connection opened. */
  readonly user: unknown;
  /** The credential the host forwarded with the connection, when there is one. */
  readonly token?: string;
  /** Aborts when the run is cancelled or out of budget. */
  readonly signal: AbortSignal;
}

/** A tool the model can call, executed inside the Engine process. */
export interface ServerTool<Input, Output> {
  /** Name the model calls the tool by. Must match `^[A-Za-z0-9_-]{1,64}$`. */
  readonly name: string;
  /** Description shown to the model. */
  readonly description: string;
  /** Schema the model's arguments are validated against. Must be pure and deterministic because it may be evaluated more than once per call. */
  readonly input: z.ZodType<Input>;
  /** Schema the tool's result is validated against. Must be pure and deterministic because it may be evaluated more than once per call. */
  readonly output: z.ZodType<Output>;
  /** Always `server`. */
  readonly locus: ToolLocus;
  /** Defaults to `non_idempotent` when declared through `serverTool`. */
  readonly sideEffect: ToolSideEffect;
  /** Defaults to `never` when declared through `serverTool`. */
  readonly approval: ToolApproval;
  /** Runs the tool. Mutating tools must check `ctx.signal` before any side effect. */
  execute(input: Input, ctx: ServerToolContext): Promise<Output>;
  /** Pure, synchronous, user-safe one-line description of a result. */
  summarize(output: Output): string;
  /**
   * Pure and synchronous. Called with the validated output of a successful
   * call and returns facts the Planner may use to plan the screen for that
   * result. Never name a Vessel, Action or parameter here.
   */
  intentFacts?(output: Output): Readonly<Record<string, JsonValue>>;
}

/** The fields an author writes. `locus`, `sideEffect` and `approval` are optional. */
export type ServerToolDefinition<Input, Output> = Omit<
  ServerTool<Input, Output>,
  'locus' | 'sideEffect' | 'approval'
> &
  Partial<Pick<ServerTool<Input, Output>, 'locus' | 'sideEffect' | 'approval'>>;

/**
 * Error whose message the tool author wrote and marked as safe to show to the
 * model and the user. Any other thrown error is replaced by a generic message.
 */
export class ToolError extends Error {
  /** @param message User-safe text the model and the user see as the failed call's summary. */
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

/**
 * Declares a Server Tool, inferring input and output types and applying
 * defaults: `locus` `server`, `sideEffect` `non_idempotent` and `approval`
 * `never`. Register it through the `tools` field of the Engine `agent`
 * config.
 *
 * @example
 * ```ts
 * const latestOrder = serverTool({
 *   name: 'latest_order',
 *   description: 'Returns the latest order of the signed-in user',
 *   input: z.object({}),
 *   output: z.object({ orderId: z.string() }),
 *   sideEffect: 'read_only',
 *   execute: (_input, ctx) => orders.latestFor(ctx.user, ctx.signal),
 *   summarize: (order) => `Order ${order.orderId}`,
 *   intentFacts: (order) => ({ orderId: order.orderId }),
 * });
 * ```
 */
export function serverTool<Input, Output>(
  definition: ServerToolDefinition<Input, Output>,
): ServerTool<Input, Output> {
  return {
    ...definition,
    locus: definition.locus ?? 'server',
    sideEffect: definition.sideEffect ?? 'non_idempotent',
    approval: definition.approval ?? 'never',
  };
}
