import { isDeferred, type Stage } from '@maelstrom-co/engine';
import { isErr } from '@maelstrom-co/protocol';
import type { Instrument, ProviderCall } from './plugin.js';

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

export interface TurnRecorder<Call extends ProviderCall = ProviderCall> {
  /** Hand to the arm to record every stage. */
  readonly instrument: Instrument;
  /** Hand to the arm to record every call of its provider client. */
  readonly onCall: (call: Call) => void;
  readonly stages: StageRecord[];
  readonly calls: Call[];
}

/** Stages to run in place of the planner's own, by name. */
export type StageReplacements = Readonly<
  Record<string, Stage<unknown, unknown>>
>;

/**
 * Records each stage's input, output, wall time and deferral, and each
 * provider call. A stage named in `replacements` runs the replacement
 * instead and is recorded as replayed.
 */
export function createRecorder<Call extends ProviderCall = ProviderCall>(
  replacements: StageReplacements = {},
): TurnRecorder<Call> {
  const stages: StageRecord[] = [];
  const calls: Call[] = [];
  const instrument: Instrument =
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
    instrument,
    onCall: (call) => calls.push(call),
    stages,
    calls,
  };
}
