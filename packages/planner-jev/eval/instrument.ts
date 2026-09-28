import { isDeferred, type Stage } from '@maelstrom-co/engine';
import { isErr } from '@maelstrom-co/protocol';

import type { StageName } from '../src/lib/defer.js';
import type { Instrument } from '../src/lib/jev-planner.js';
import type { JevCall } from '../src/lib/typesafe-client.js';

export interface StageRecord {
  readonly stage: StageName;
  readonly ms: number;
  readonly outcome: 'ok' | 'deferred' | 'error';
  /** The stage's output, when it produced one. */
  readonly output?: unknown;
  /** The deferral reason, `<stage>/<code>`. */
  readonly reason?: string;
  readonly errorTag?: string;
}

export interface TurnRecorder {
  /** Pass to `buildJevPlanner` to record every stage. */
  readonly instrument: Instrument;
  /** Pass as the TypeSafe client's `onCall` to record every Jev call. */
  readonly onCall: (call: JevCall) => void;
  readonly stages: StageRecord[];
  readonly calls: JevCall[];
}

/** Records each stage's output, wall time and deferral, and each Jev call. */
export function createRecorder(): TurnRecorder {
  const stages: StageRecord[] = [];
  const calls: JevCall[] = [];
  const instrument: Instrument =
    <In, Out>(name: StageName, stage: Stage<In, Out>): Stage<In, Out> =>
    async (input, ctx) => {
      const started = performance.now();
      const result = await stage(input, ctx);
      const ms = performance.now() - started;
      if (!isErr(result))
        stages.push({ stage: name, ms, outcome: 'ok', output: result.value });
      else if (isDeferred(result.error))
        stages.push({
          stage: name,
          ms,
          outcome: 'deferred',
          reason: result.error.reason,
        });
      else
        stages.push({
          stage: name,
          ms,
          outcome: 'error',
          errorTag: result.error._tag,
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
