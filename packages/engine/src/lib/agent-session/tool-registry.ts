import type { JsonValue } from '@maelstrom-co/protocol';
import type { z } from 'zod';

import {
  TOOL_APPROVALS,
  TOOL_LOCI,
  TOOL_SIDE_EFFECTS,
  type ServerToolContext,
  type ToolApproval,
  type ToolLocus,
  type ToolSideEffect,
} from './server-tool.js';

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** A Server Tool with its input and output types erased so tools of different types share one list. */
export interface RegistrableServerTool {
  /** Name the model calls the tool by. Must match `^[A-Za-z0-9_-]{1,64}$`. */
  readonly name: string;
  /** Description shown to the model. */
  readonly description: string;
  /** Schema the model's arguments are validated against. */
  readonly input: z.ZodType<unknown>;
  /** Schema the tool's result is validated against. */
  readonly output: z.ZodType<unknown>;
  /** Where the tool runs. */
  readonly locus: ToolLocus;
  /** How the tool affects the world. */
  readonly sideEffect: ToolSideEffect;
  /** Whether a call needs user approval before it runs. */
  readonly approval: ToolApproval;
  /** Runs the tool with validated input. */
  execute(input: never, ctx: ServerToolContext): Promise<unknown>;
  /** Pure, synchronous, user-safe one-line description of a result. */
  summarize(output: never): string;
  /** Pure, synchronous facts about a successful result for the Planner. */
  intentFacts?(output: never): Readonly<Record<string, JsonValue>>;
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
  /** The tool's author-written facts extractor, absent when the tool declares none. */
  readonly intentFacts?: (
    output: unknown,
  ) => Readonly<Record<string, JsonValue>>;
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
 * @throws When a name is not a string, is duplicated or does not match
 * `^[A-Za-z0-9_-]{1,64}$`, when `summarize` or `execute` is not a function, when `intentFacts` is
 * present and not a function,
 * when `input` or `output` is not a schema with a `safeParseAsync` function,
 * or when `locus`, `sideEffect` or `approval` (after defaults) is not an
 * allowed value.
 */
export function createToolRegistry(
  tools: readonly RegistrableServerTool[],
): ToolRegistry {
  const byName = new Map<string, ToolRegistryEntry>();
  for (const tool of tools) {
    if (typeof tool.name !== 'string') {
      throw new Error(
        `Invalid server tool name ${String(tool.name)}: must be a string`,
      );
    }
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
    if (typeof tool.execute !== 'function') {
      throw new Error(`Server tool "${tool.name}" must define execute`);
    }
    const { intentFacts } = tool;
    if (intentFacts !== undefined && typeof intentFacts !== 'function') {
      throw new Error(
        `Server tool "${tool.name}" must define intentFacts as a function`,
      );
    }
    assertSchema(tool.name, 'input', tool.input);
    assertSchema(tool.name, 'output', tool.output);
    byName.set(tool.name, {
      tool,
      locus: allowedValue(tool.name, 'locus', tool.locus, TOOL_LOCI),
      sideEffect: allowedValue(
        tool.name,
        'sideEffect',
        tool.sideEffect ?? 'non_idempotent',
        TOOL_SIDE_EFFECTS,
      ),
      approval: allowedValue(
        tool.name,
        'approval',
        tool.approval ?? 'never',
        TOOL_APPROVALS,
      ),
      summarize: (output) => tool.summarize(output as never),
      ...(intentFacts === undefined
        ? {}
        : { intentFacts: (output) => intentFacts.call(tool, output as never) }),
    });
  }
  return {
    get: (name) => byName.get(name),
    entries: () => [...byName.values()],
  };
}

function allowedValue<T extends string>(
  toolName: string,
  field: string,
  value: unknown,
  allowed: readonly T[],
): T {
  if (!allowed.includes(value as T)) {
    throw new Error(
      `Server tool "${toolName}" has invalid ${field} ${JSON.stringify(value)}`,
    );
  }
  return value as T;
}

function assertSchema(toolName: string, field: string, schema: unknown): void {
  if (
    typeof schema !== 'object' ||
    schema === null ||
    typeof (schema as { safeParseAsync?: unknown }).safeParseAsync !==
      'function'
  ) {
    throw new Error(
      `Server tool "${toolName}" must define ${field} as a schema with safeParseAsync`,
    );
  }
}
