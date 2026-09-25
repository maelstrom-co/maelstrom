import type { Stage } from './stage.js';

/**
 * Flat attributes of one {@link Instrument.event}. Values are scalars only;
 * anything structured belongs somewhere other than the telemetry seam.
 *
 * Keys at provider call sites use the OpenTelemetry GenAI names verbatim
 * (`gen_ai.request.model`, `gen_ai.usage.input_tokens`,
 * `gen_ai.usage.output_tokens`); Maelstrom-specific keys are prefixed
 * `maelstrom.` (for example `maelstrom.stage`, `maelstrom.latency_ms`).
 */
export type InstrumentAttributes = Readonly<
  Record<string, string | number | boolean>
>;

/**
 * The telemetry seam of the planner. The Engine takes one from
 * `EngineConfig.instrument` (default {@link noopInstrument}) and hands it to
 * every stage as `StageContext.instrument`.
 *
 * {@link pipeline} wraps each of its stages with {@link Instrument.stage}
 * once per request, before running it. Stages and the clients they call
 * report what happens inside them with {@link Instrument.event}.
 *
 * @example
 * ```ts
 * const loggingInstrument: Instrument = {
 *   stage: (name, stage) => async (input, ctx) => {
 *     const started = performance.now();
 *     const result = await stage(input, ctx);
 *     console.info('stage', name, performance.now() - started);
 *     return result;
 *   },
 *   event: (name, attributes) => console.info(name, attributes),
 * };
 * const engine = createEngine({ planner, instrument: loggingInstrument });
 * ```
 */
export interface Instrument {
  /**
   * Wraps one stage of a pipeline for one request. Return `stage` itself, a
   * stage that calls through to it (to time or trace it), or a different
   * stage entirely (for example one that replays a recorded output).
   *
   * @param name - The name given with {@link named}, or `stage-<index>` for
   *   an unnamed stage, counting from 0 within its pipeline.
   * @param stage - The stage about to run.
   */
  stage<In, Out>(name: string, stage: Stage<In, Out>): Stage<In, Out>;
  /**
   * Reports one thing that happened inside a stage, such as a model call.
   * Names are dotted lower-case strings owned by the emitter (for example
   * `llm.call`). Must not throw.
   */
  event(name: string, attributes: InstrumentAttributes): void;
}

/** An {@link Instrument} that returns every stage unchanged and ignores every event. */
export const noopInstrument: Instrument = {
  stage: (_name, stage) => stage,
  event: () => undefined,
};

const stageNames = new WeakMap<object, string>();

/**
 * Names `stage` for {@link Instrument.stage} and returns the same function.
 * No wrapper is created, so naming a stage never changes what it does. A
 * stage named twice keeps the last name.
 *
 * @example
 * ```ts
 * const planner = pipeline(named('select', select), named('layout', layout));
 * ```
 */
export function named<In, Out>(
  name: string,
  stage: Stage<In, Out>,
): Stage<In, Out> {
  stageNames.set(stage, name);
  return stage;
}

/** The name given to `stage` with {@link named}, or `undefined` when it has none. */
export function stageName<In, Out>(stage: Stage<In, Out>): string | undefined {
  return stageNames.get(stage);
}
