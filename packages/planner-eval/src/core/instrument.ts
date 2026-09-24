import { isDeferred, type Stage } from '@maelstrom-co/engine';
import type {
  Instrument,
  JevCall,
  StageName,
} from '@maelstrom-co/planner-jev/_eval';
import { isErr } from '@maelstrom-co/protocol';

export interface StageRecord {
  readonly stage: StageName;
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

export interface TurnRecorder {
  /** Pass to `buildJevPlanner` to record every stage. */
  readonly instrument: Instrument;
  /** Pass as the TypeSafe client's `onCall` to record every Jev call. */
  readonly onCall: (call: JevCall) => void;
  readonly stages: StageRecord[];
  readonly calls: JevCall[];
}

/** Stages to run in place of the planner's own, by name. */
export type StageReplacements = Readonly<
  Partial<Record<StageName, Stage<unknown, unknown>>>
>;

/**
 * Records each stage's input, output, wall time and deferral, and each Jev
 * call. A stage named in `replacements` runs the replacement instead and is
 * recorded as replayed.
 */
export function createRecorder(
  replacements: StageReplacements = {},
): TurnRecorder {
  const stages: StageRecord[] = [];
  const calls: JevCall[] = [];
  const instrument: Instrument =
    <In, Out>(name: StageName, live: Stage<In, Out>): Stage<In, Out> =>
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
