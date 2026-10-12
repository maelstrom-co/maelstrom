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
import { createEngine, type Engine } from '@maelstrom-co/engine';
import {
  jevComposedPairsPlanner,
  jevPlanner,
  type TypeSafeOptions,
} from '@maelstrom-co/planner-jev';
import { type LlmPlannerOptions, llmPlanner } from '@maelstrom-co/planner-llm';
import {
  createAgentPlanner,
  PLANNER_SYSTEM_RULES,
  type PlannerEnv,
} from './agent-planner';
import { withPlannerReasoning } from './engine-model';

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
  /**
   * PROTOTYPE (MAE-826): the transport's environment, read by
   * {@link createAgentPlanner} for `AGENT_PLANNER` and the light tier's
   * decision model.
   */
  readonly env?: PlannerEnv;
}

/**
 * PROTOTYPE (MAE-826): builds the Engine the Engine facade uses only as its
 * Planner. No history (the Agent Session transcript is the only history) and
 * `retry: false`, because {@link createAgentPlanner} retries its LLM tier.
 */
export function createPlaygroundEngine(
  options: PlaygroundEngineOptions,
): Engine {
  const modelOptions = withPlannerReasoning(options.modelOptions);
  return createEngine({
    planner: createAgentPlanner({
      adapter: options.adapter,
      ...(modelOptions === undefined ? {} : { modelOptions }),
      ...(options.env === undefined ? {} : { env: options.env }),
    }),
    retry: false,
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
        prompt: { system: { rules: { append: PLANNER_SYSTEM_RULES } } },
        ...modelOptions,
      }),
    }),
    retry: false,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}
