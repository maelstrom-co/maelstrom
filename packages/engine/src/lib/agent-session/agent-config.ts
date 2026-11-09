import type { AnyTextAdapter } from '@tanstack/ai';

import {
  DEFAULT_AGENT_RUN_BUDGETS,
  type AgentRunBudgets,
  type AgentRunRetry,
} from './agent-run.js';
import {
  createToolRegistry,
  type RegistrableServerTool,
  type ToolRegistry,
} from './tool-registry.js';

/**
 * Who an Agent Run acts for, as supplied when the connection opened. Model
 * factories and budget resolvers receive it once per run. It never reaches a
 * prompt, tool arguments or an event.
 */
export interface AgentRunContext {
  /** The user supplied when the connection opened, passed through unchanged. */
  readonly user: unknown;
  /** The credential the host forwarded with the connection, when there is one. */
  readonly token?: string;
}

/**
 * Picks the text adapter for one Agent Run. Called once per run before the
 * run starts, and the returned adapter serves every model turn of that run.
 * For a per-turn model choice, return a delegating adapter that picks an
 * inner adapter per call. A throw, a rejection, or a value without a
 * `chatStream` method ends the run with an error before it starts.
 */
export type AgentModelFactory = (
  ctx: AgentRunContext,
) => AnyTextAdapter | Promise<AnyTextAdapter>;

/**
 * Picks the budgets for one Agent Run. Called once per run before the run
 * starts. Returned fields replace the Engine defaults, and omitted fields
 * keep them. The same validation as static budgets applies, so an unknown
 * field ends the run with an error. A throw or rejection also ends the run
 * with an error. The resolver caps a single run, not
 * total spend.
 */
export type AgentBudgetResolver = (
  ctx: AgentRunContext,
) => Partial<AgentRunBudgets> | Promise<Partial<AgentRunBudgets>>;

/**
 * The `agent` slot of the Engine config. When present, utterances run as
 * Agent Runs that call the configured tools. Read once when the Engine is
 * created.
 */
export interface AgentConfig {
  /**
   * The text adapter serving every run, or a factory that picks one per run.
   * A value of type `function` is treated as a factory. Any other value must
   * be an object with a `chatStream` method, or Engine creation throws.
   */
  readonly model: AnyTextAdapter | AgentModelFactory;
  /** System instructions sent with every model turn. Defaults to an empty string. */
  readonly instructions?: string;
  /**
   * The Server Tools the model may call. Defaults to none. Every tool must
   * define `summarize`, and names must be unique, or Engine creation throws.
   */
  readonly tools?: readonly RegistrableServerTool[];
  /**
   * Caps for each run, as static values or a resolver called once per run.
   * Fields left out default to 12 turns, 120,000 ms, 100,000
   * tokens and 24 tool calls. Every value must be a
   * non-negative integer. `maxTokens` and `maxElapsedMs` also accept
   * `Infinity`, which removes that cap. `maxTurns` and `maxToolCalls` must
   * stay finite, so every run keeps a hard bound on its loop. Any other
   * field is rejected, so a misspelled cap fails instead of falling back to
   * its default. Static values are validated when the Engine is created.
   */
  readonly budgets?: Partial<AgentRunBudgets> | AgentBudgetResolver;
  /** Rate-limit retry for each model call. Defaults to no retry. */
  readonly retry?: AgentRunRetry;
}

/** {@link AgentConfig} with its defaults applied and its tools registered. */
export interface ResolvedAgentConfig {
  /** The configured adapter or model factory. */
  readonly model: AnyTextAdapter | AgentModelFactory;
  /** The configured instructions, or an empty string. */
  readonly instructions: string;
  /** Registry built once from the configured tools. */
  readonly registry: ToolRegistry;
  /** Static budgets merged over the defaults, or the configured resolver. */
  readonly budgets: AgentRunBudgets | AgentBudgetResolver;
  /** The configured retry, or `undefined` for none. */
  readonly retry: AgentRunRetry | undefined;
}

/** The adapter and budgets resolved for one Agent Run. */
export interface AgentRunSetup {
  /** The text adapter serving every model turn of the run. */
  readonly adapter: AnyTextAdapter;
  /** Caps for the run, frozen. */
  readonly budgets: AgentRunBudgets;
}

/**
 * Validates an {@link AgentConfig} and applies its defaults. Static budgets
 * are validated and merged over {@link DEFAULT_AGENT_RUN_BUDGETS}, and the
 * tool registry is built once.
 * @throws When `model` is neither a function nor an object with a
 * `chatStream` method, when a static budget has an invalid value or an
 * unknown field, or when a tool fails registration (for example a
 * missing `summarize` or a duplicate name).
 */
export function resolveAgentConfig(config: AgentConfig): ResolvedAgentConfig {
  if (typeof config.model !== 'function' && !isTextAdapter(config.model)) {
    throw new Error(
      'Invalid agent config: model must be a text adapter or a model factory',
    );
  }
  const budgets = config.budgets;
  return {
    model: config.model,
    instructions: config.instructions ?? '',
    registry: createToolRegistry(config.tools ?? []),
    budgets:
      typeof budgets === 'function'
        ? budgets
        : mergeOverDefaults(validateBudgets(budgets ?? {}, 'agent config')),
    retry: config.retry,
  };
}

/**
 * Resolves the adapter and budgets for one Agent Run. Call it once per run,
 * before the run starts. The budget resolver and the model factory, when
 * configured, are each called exactly once with `ctx`.
 *
 * Budget precedence: {@link DEFAULT_AGENT_RUN_BUDGETS}, then the resolver's
 * or the static values, then `override`, which can only lower a value.
 * The returned promise rejects when the resolver or the factory throws or
 * rejects, when the factory returns a value without a `chatStream` method,
 * or when the resolver or `override` yields a value or field that breaks the
 * rules of {@link AgentConfig.budgets}.
 */
export async function resolveAgentRunSetup(
  resolved: ResolvedAgentConfig,
  ctx: AgentRunContext,
  override?: Partial<AgentRunBudgets>,
): Promise<AgentRunSetup> {
  const configured =
    typeof resolved.budgets === 'function'
      ? mergeOverDefaults(
          validateBudgets(await resolved.budgets(ctx), 'budget resolver'),
        )
      : resolved.budgets;
  const budgets = tightenAgentRunBudgets(
    configured,
    override === undefined
      ? undefined
      : validateBudgets(override, 'per-run override'),
  );
  const adapter =
    typeof resolved.model === 'function'
      ? await resolved.model(ctx)
      : resolved.model;
  if (!isTextAdapter(adapter)) {
    throw new Error('Agent model factory did not return a text adapter');
  }
  return { adapter, budgets };
}

/**
 * Lowers each field of `base` to the matching `override` field when that is
 * smaller. Never raises a value. Returns a frozen copy and does not validate.
 */
export function tightenAgentRunBudgets(
  base: AgentRunBudgets,
  override?: Partial<AgentRunBudgets>,
): AgentRunBudgets {
  const tightened = { ...base };
  for (const field of BUDGET_FIELDS) {
    const value = override?.[field];
    if (value !== undefined && value < tightened[field]) {
      tightened[field] = value;
    }
  }
  return Object.freeze(tightened);
}

const BUDGET_FIELDS = [
  'maxTurns',
  'maxElapsedMs',
  'maxTokens',
  'maxToolCalls',
] as const satisfies readonly (keyof AgentRunBudgets)[];

const UNCAPPABLE_FIELDS: ReadonlySet<keyof AgentRunBudgets> = new Set([
  'maxElapsedMs',
  'maxTokens',
]);

function validateBudgets(
  budgets: unknown,
  source: string,
): Partial<AgentRunBudgets> {
  if (typeof budgets !== 'object' || budgets === null) {
    throw new Error(`Invalid agent budgets from ${source}: expected an object`);
  }
  for (const key of Object.keys(budgets)) {
    if (!(BUDGET_FIELDS as readonly string[]).includes(key)) {
      throw new Error(
        `Invalid agent budget field ${key} from ${source}. Allowed fields: ${BUDGET_FIELDS.join(', ')}.`,
      );
    }
  }
  const record = budgets as Partial<Record<keyof AgentRunBudgets, unknown>>;
  const valid: { -readonly [K in keyof AgentRunBudgets]?: number } = {};
  for (const field of BUDGET_FIELDS) {
    const value = record[field];
    if (value === undefined) continue;
    if (!isValidBudgetValue(field, value)) {
      throw new Error(
        `Invalid agent budget ${field} from ${source}: ${String(value)}. ${budgetRule(field)}`,
      );
    }
    valid[field] = value;
  }
  return valid;
}

function isTextAdapter(value: unknown): value is AnyTextAdapter {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { chatStream?: unknown }).chatStream === 'function'
  );
}

function isValidBudgetValue(
  field: keyof AgentRunBudgets,
  value: unknown,
): value is number {
  if (typeof value !== 'number' || value < 0) return false;
  if (value === Infinity) return UNCAPPABLE_FIELDS.has(field);
  return Number.isInteger(value);
}

function budgetRule(field: keyof AgentRunBudgets): string {
  return UNCAPPABLE_FIELDS.has(field)
    ? 'Must be a non-negative integer or Infinity.'
    : 'Must be a finite non-negative integer.';
}

function mergeOverDefaults(budgets: Partial<AgentRunBudgets>): AgentRunBudgets {
  return Object.freeze({ ...DEFAULT_AGENT_RUN_BUDGETS, ...budgets });
}
