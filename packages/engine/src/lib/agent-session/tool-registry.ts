import type { z } from 'zod';

import type {
  ServerToolContext,
  ToolApproval,
  ToolLocus,
  ToolSideEffect,
} from './server-tool.js';

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** A Server Tool with its input and output types erased so tools of different types share one list. */
export interface RegistrableServerTool {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodType<unknown>;
  readonly output: z.ZodType<unknown>;
  readonly locus: ToolLocus;
  readonly sideEffect: ToolSideEffect;
  readonly approval: ToolApproval;
  execute(input: never, ctx: ServerToolContext): Promise<unknown>;
  summarize(output: never): string;
}

/** A registered tool with its normalized execution metadata. */
export interface ToolRegistryEntry {
  /** The declared tool. */
  readonly tool: RegistrableServerTool;
  /** Where the tool runs. */
  readonly locus: ToolLocus;
  /** The tool's side-effect class. */
  readonly sideEffect: ToolSideEffect;
  /** The tool's approval policy. */
  readonly approval: ToolApproval;
  /** The tool's author-written result summarizer. */
  readonly summarize: (output: unknown) => string;
}

/** Lookup over the registered tools. */
export interface ToolRegistry {
  /** Returns the entry for `name`, or `undefined` when no such tool is registered. */
  get(name: string): ToolRegistryEntry | undefined;
  /** Returns every entry in registration order. */
  entries(): readonly ToolRegistryEntry[];
}

/**
 * Builds a registry from tool declarations.
 * @throws When a name is duplicated, a name does not match `^[A-Za-z0-9_-]{1,64}$`, or `summarize` is missing.
 */
export function createToolRegistry(
  tools: readonly RegistrableServerTool[],
): ToolRegistry {
  const byName = new Map<string, ToolRegistryEntry>();
  for (const tool of tools) {
    if (!TOOL_NAME_PATTERN.test(tool.name)) {
      throw new Error(
        `Invalid server tool name ${JSON.stringify(tool.name)}: must match ${TOOL_NAME_PATTERN.source}`,
      );
    }
    if (byName.has(tool.name)) {
      throw new Error(`Duplicate server tool name "${tool.name}"`);
    }
    if (typeof tool.summarize !== 'function') {
      throw new Error(`Server tool "${tool.name}" must define summarize`);
    }
    byName.set(tool.name, {
      tool,
      locus: tool.locus,
      sideEffect: tool.sideEffect ?? 'non_idempotent',
      approval: tool.approval ?? 'never',
      summarize: (output) => tool.summarize(output as never),
    });
  }
  return {
    get: (name) => byName.get(name),
    entries: () => [...byName.values()],
  };
}
