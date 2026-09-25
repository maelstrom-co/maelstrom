import {
  type Instrument,
  type InstrumentAttributes,
  isDeferred,
  type Stage,
} from '@maelstrom-co/engine';
import { isErr } from '@maelstrom-co/protocol';
import type { ProviderCall } from './plugin.js';

export interface StageRecord {
  readonly stage: string;
  readonly ms: number;
  readonly outcome: 'ok' | 'deferred' | 'error';
  /** The stage's input, on every outcome. */
  readonly input?: unknown;
  /** The stage's output, when it produced one. */
  readonly output?: unknown;
  /** The deferral reason, `<stage>/<code>`. */
  readonly reason?: string;
  readonly errorTag?: string;
  /** The stage replayed a recorded result instead of running. */
  readonly replayed?: boolean;
}

/** One event a stage reported through the instrument. */
export interface EventRecord {
  readonly name: string;
  readonly attributes: InstrumentAttributes;
}

export interface TurnRecorder<Call extends ProviderCall = ProviderCall> {
  /** Hand to the Engine to record every pipeline stage and event. */
  readonly instrument: Instrument;
  /** Hand to the arm to record every call of its provider client. */
  readonly onCall: (call: Call) => void;
  readonly stages: StageRecord[];
  readonly calls: Call[];
  readonly events: EventRecord[];
}

/** Stages to run in place of the planner's own, by name. */
export type StageReplacements = Readonly<
  Record<string, Stage<unknown, unknown>>
>;

/**
 * Records each stage's input, output, wall time and deferral, each
 * provider call and each instrument event. A stage named in `replacements`
 * runs the replacement instead and is recorded as replayed.
 */
export function createRecorder<Call extends ProviderCall = ProviderCall>(
  replacements: StageReplacements = {},
): TurnRecorder<Call> {
  const stages: StageRecord[] = [];
  const calls: Call[] = [];
  const events: EventRecord[] = [];
  const recordStage =
    <In, Out>(name: string, live: Stage<In, Out>): Stage<In, Out> =>
    async (input, ctx) => {
      const replacement = replacements[name];
      const stage = (replacement ?? live) as Stage<In, Out>;
      const replayed = replacement !== undefined && { replayed: true };
      const started = performance.now();
      const result = await stage(input, ctx);
      const ms = performance.now() - started;
      if (!isErr(result))
        stages.push({
          stage: name,
          ms,
          outcome: 'ok',
          input,
          output: result.value,
          ...replayed,
        });
      else if (isDeferred(result.error))
        stages.push({
          stage: name,
          ms,
          outcome: 'deferred',
          input,
          reason: result.error.reason,
          ...replayed,
        });
      else
        stages.push({
          stage: name,
          ms,
          outcome: 'error',
          input,
          errorTag: result.error._tag,
          ...replayed,
        });
      return result;
    };
  return {
    instrument: {
      stage: recordStage,
      event: (name, attributes) => events.push({ name, attributes }),
    },
    onCall: (call) => calls.push(call),
    stages,
    calls,
    events,
  };
}
