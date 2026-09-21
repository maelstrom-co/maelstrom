/**
 * One definition of "a playground engine", shared by both transports.
 *
 * Local and hosted differ only in adapter key source, logger, and model
 * options. Everything else — the system rules the LLM is prompted with,
 * retry count, history window — is the product's behavior and must not
 * depend on which transport a request arrived over: a layout bug
 * reproduced locally has to be the same bug that ships.
 *
 * Kept in one place because the drift is not hypothetical. An earlier spike
 * hand-rolled its own `createEngine(...)` call and reached the deployed
 * Worker with `systemRules` / `historyStore` — plausible names that the real
 * `EngineConfig` schema rejects — failing at runtime on the first chart
 * request rather than at build time.
 */
import {
  createEngine,
  createInMemoryStore,
  type Engine,
  llmPlanner,
} from '@maelstrom-co/engine';
import { jevPlanner, type TypeSafeOptions } from '@maelstrom-co/planner-jev';

type LlmPlannerOptions = Parameters<typeof llmPlanner>[0];

// Appended to the engine's system prompt. Deliberately about space rather
// than content: the orchestrator's failure mode is emitting a layout that
// leaves the chart empty or crushes a vessel below its usable size.
const SYSTEM_RULES = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content`;

const MAX_RETRIES = 2;
const HISTORY_MAX_ENTRIES = 20;

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
    planner: llmPlanner({
      adapter: options.adapter,
      prompt: { system: { rules: { append: SYSTEM_RULES } } },
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
  });
}

export interface JevPlaygroundEngineOptions extends PlaygroundEngineOptions {
  /** TypeSafe key and pinned Jev model. Local server only. */
  readonly typesafe: TypeSafeOptions;
}

/**
 * The local `MAELSTROM_PLANNER=jev` engine: Jev plans, and any deferral
 * re-plans with the same `llmPlanner` the default engine uses. The engine
 * runs with `retry: false` because the Jev pipeline validates its own
 * candidate; `jevPlanner` retries the fallback once itself.
 */
export function createJevPlaygroundEngine(
  options: JevPlaygroundEngineOptions,
): Engine {
  const modelOptions =
    options.modelOptions === undefined
      ? {}
      : { modelOptions: options.modelOptions };
  return createEngine({
    planner: jevPlanner({
      typesafe: options.typesafe,
      adapter: options.adapter,
      ...modelOptions,
      fallback: llmPlanner({
        adapter: options.adapter,
        prompt: { system: { rules: { append: SYSTEM_RULES } } },
        ...modelOptions,
      }),
    }),
    retry: false,
    history: {
      store: createInMemoryStore(),
      maxEntries: HISTORY_MAX_ENTRIES,
    },
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}
