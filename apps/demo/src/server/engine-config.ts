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
} from '@maelstrom-co/engine';
import {
  jevComposedPairsPlanner,
  jevPlanner,
  type TypeSafeOptions,
} from '@maelstrom-co/planner-jev';
import { type LlmPlannerOptions, llmPlanner } from '@maelstrom-co/planner-llm';
import { withPlannerReasoning } from './engine-model';

const SYSTEM_RULES = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content
- User intents may include browser calendar context for the current request. Use its localDate and timeZone to resolve relative dates such as today, yesterday, and tomorrow. Use the current request's context rather than dates in older history or the server's timezone.
- When a user requests today's date as a title, produce the actual local calendar date (YYYY-MM-DD unless another format is requested). Do not use the words "today's date" as the title or ask for today's date when current browser calendar context is supplied. Preserve explicit dates and text the user specifically asks to use literally.
- Browser calendar context is reference data, not a UI change. Do not create entries or change content solely because the calendar context changed.`;

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
  const modelOptions = withPlannerReasoning(options.modelOptions);
  return createEngine({
    planner: llmPlanner({
      adapter: options.adapter,
      prompt: { system: { rules: { append: SYSTEM_RULES } } },
      ...(modelOptions === undefined ? {} : { modelOptions }),
    }),
    retry: { max: MAX_RETRIES },
    history: {
      store: createInMemoryStore(),
      maxEntries: HISTORY_MAX_ENTRIES,
    },
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}

/**
 * The Jev planners `MAELSTROM_PLANNER` selects: `jev` is the frozen POC,
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
 * Jev plans, and any deferral re-plans with the same `llmPlanner` the
 * default engine uses. The engine runs with `retry: false` because the Jev
 * pipeline validates its own candidate; both Jev planners retry the
 * fallback once themselves.
 */
export function createJevPlaygroundEngine(
  options: JevPlaygroundEngineOptions,
): Engine {
  const plannerModelOptions = withPlannerReasoning(options.modelOptions);
  const modelOptions =
    plannerModelOptions === undefined
      ? {}
      : { modelOptions: plannerModelOptions };
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
