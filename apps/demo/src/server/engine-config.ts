/**
 * One definition of "a playground engine", shared by both transports.
 *
 * Local and hosted differ in adapter key source, logger, model options and,
 * for now, the agent slot: only local engines register the agent and its
 * Server Tools, while the hosted Worker stays on the chart planner path.
 * Everything else — the system rules the LLM is prompted with, retry count,
 * history window — is the product's behavior and must not depend on which
 * transport a request arrived over: a layout bug reproduced locally has to
 * be the same bug that ships.
 *
 * Kept in one place because the drift is not hypothetical. An earlier spike
 * hand-rolled its own `createEngine(...)` call and reached the deployed
 * Worker with `systemRules` / `historyStore` — plausible names that the real
 * `EngineConfig` schema rejects — failing at runtime on the first chart
 * request rather than at build time.
 */
import {
  type AgentConfig,
  createEngine,
  createInMemoryStore,
  type Engine,
} from '@maelstrom-co/engine';
import {
  jevComposedPairsPlanner,
  jevPlanner,
  type TypeSafeOptions,
} from '@maelstrom-co/planner-jev';
import {
  clarifyingLlmPlanner,
  type LlmPlannerOptions,
  llmPlanner,
} from '@maelstrom-co/planner-llm';

import { latestOrderTool } from './latest-order-tool';
import { PLAYGROUND_SYSTEM_RULES } from './planner-system-rules';
import { searchProductsTool } from './search-products-tool';

const MAX_RETRIES = 2;
const HISTORY_MAX_ENTRIES = 20;
const DEMO_AGENT_INSTRUCTIONS = [
  'You are the assistant for the pet shop demo. Use your tools to look up order data instead of guessing, and answer briefly.',
  'Each successful tool result is offered to the screen automatically.',
  'Describe the data in your reply. You may say you are bringing it up.',
  'Notes in the conversation tell you what happened to each show, such as "Show queued" or "Screen updated".',
  'Say something is on screen only after a "Screen updated" note says so.',
].join(' ');

export interface PlaygroundEngineOptions {
  /** Provider binding — the one genuinely per-transport choice. */
  readonly adapter: LlmPlannerOptions['adapter'];
  /**
   * Both transports MUST pass a redacting logger. The default `consoleLogger`
   * writes provider SDK errors verbatim, including OpenAI's 401 echo of the
   * key it rejected. Hosted mode retains whatever reaches stdout via the
   * Worker's `observability.logs.persist`; local mode still holds a
   * long-lived `OPENAI_API_KEY` that must not land in terminal or CI logs.
   */
  readonly logger?: Parameters<typeof createEngine>[0]['logger'];
  readonly modelOptions?: LlmPlannerOptions['modelOptions'];
  /** Agent slot. Set on local engines only, so the hosted Worker omits it. */
  readonly agent?: AgentConfig;
}

/**
 * The local demo agent: the pet shop assistant with the latest-order and
 * product-search Server Tools, served by `adapter` and capped by the Engine
 * budget defaults.
 */
export function createDemoAgentConfig(
  adapter: LlmPlannerOptions['adapter'],
): AgentConfig {
  return {
    model: adapter,
    instructions: DEMO_AGENT_INSTRUCTIONS,
    tools: [latestOrderTool, searchProductsTool],
  };
}

/**
 * Builds an engine with the playground's shared behavior. Each call gets its
 * own history store — history is per engine, and two engines sharing one
 * store would cross conversations between the keys that built them.
 */
export function createPlaygroundEngine(
  options: PlaygroundEngineOptions,
): Engine {
  return createEngine({
    planner: clarifyingLlmPlanner({
      adapter: options.adapter,
      prompt: { system: { rules: { append: PLAYGROUND_SYSTEM_RULES } } },
      ...(options.modelOptions === undefined
        ? {}
        : { modelOptions: options.modelOptions }),
    }),
    retry: { max: MAX_RETRIES },
    history: {
      store: createInMemoryStore(),
      maxEntries: HISTORY_MAX_ENTRIES,
    },
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.agent === undefined ? {} : { agent: options.agent }),
  });
}

/**
 * The Jev planners `MAELSTROM_PLANNER` selects: `jev` is the POC planner,
 * `jev-composed-pairs` the experimental planner that composes the layout
 * from Jev's answers about pairs of instances.
 */
export type JevPlannerName = 'jev' | 'jev-composed-pairs';

export interface JevPlaygroundEngineOptions extends PlaygroundEngineOptions {
  /** Which Jev planner plans. Defaults to `jev`. */
  readonly planner?: JevPlannerName;
  /** TypeSafe key and pinned Jev model. Local server only. */
  readonly typesafe: TypeSafeOptions;
}

/**
 * The local Jev engine (`MAELSTROM_PLANNER=jev` or `jev-composed-pairs`):
 * Jev plans, and any deferral re-plans with `llmPlanner`, because the Jev
 * `fallback` type cannot accept a clarification. The engine runs with
 * `retry: false` because the Jev pipeline validates its own candidate. Both
 * Jev planners retry the fallback once themselves.
 */
export function createJevPlaygroundEngine(
  options: JevPlaygroundEngineOptions,
): Engine {
  const modelOptions =
    options.modelOptions === undefined
      ? {}
      : { modelOptions: options.modelOptions };
  const planner =
    options.planner === 'jev-composed-pairs'
      ? jevComposedPairsPlanner
      : jevPlanner;
  return createEngine({
    planner: planner({
      typesafe: options.typesafe,
      adapter: options.adapter,
      ...modelOptions,
      fallback: llmPlanner({
        adapter: options.adapter,
        prompt: { system: { rules: { append: PLAYGROUND_SYSTEM_RULES } } },
        ...modelOptions,
      }),
    }),
    retry: false,
    history: {
      store: createInMemoryStore(),
      maxEntries: HISTORY_MAX_ENTRIES,
    },
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.agent === undefined ? {} : { agent: options.agent }),
  });
}
