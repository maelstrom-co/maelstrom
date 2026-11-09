import type { z } from 'zod';

/** Where a tool runs. Only `server` exists today. */
export type ToolLocus = 'server';

/** How a tool affects the world, used to decide whether repeating or parallelizing it is safe. */
export type ToolSideEffect = 'read_only' | 'idempotent' | 'non_idempotent';

/** Whether a call needs user approval before it runs. Only `never` exists today. */
export type ToolApproval = 'never';

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
  /** Schema the model's arguments are validated against. */
  readonly input: z.ZodType<Input>;
  /** Schema the tool's result is validated against. */
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
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

/** Declares a Server Tool, inferring input and output types and applying defaults. */
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
