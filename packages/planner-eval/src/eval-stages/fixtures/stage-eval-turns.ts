import { readFile } from 'node:fs/promises';

import type { TilingNode } from '@maelstrom-co/protocol';

import type { ReplayAnswers } from '@maelstrom-co/planner-jev/_testing';

/** A layout stage-eval turn recorded against a scenario's gold input. */
export interface StageEvalReplayTurn {
  /** `<run>/<scenarioId>#<repeat>`, the run being `combined`, `combined-holdout` or `gold`. */
  readonly key: string;
  /** The id of the scenario in `src/eval/scenarios.ts` whose gold input the turn ran on. */
  readonly scenarioId: string;
  /** Which repeat of the scenario the turn was, from 1. */
  readonly repeat: number;
  /** The tree the stage shipped, or `null` when it deferred. */
  readonly recordedTree: readonly TilingNode[] | null;
  /** The answers of the turn's layout call. */
  readonly answers: ReplayAnswers;
}

/** Every recorded layout stage-eval turn. */
export async function loadStageEvalTurns(): Promise<
  readonly StageEvalReplayTurn[]
> {
  const parsed: unknown = JSON.parse(
    await readFile(new URL('./stage-eval-turns.json', import.meta.url), 'utf8'),
  );
  if (!Array.isArray(parsed))
    throw new Error('stage-eval-turns.json holds no list of turns');
  return parsed as readonly StageEvalReplayTurn[];
}
