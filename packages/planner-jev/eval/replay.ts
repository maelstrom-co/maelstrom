import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { deferred, type Stage } from '@maelstrom-co/engine';
import { err, ok } from '@maelstrom-co/protocol';

import type { StageName } from '../src/lib/defer.js';
import type { StageRecord } from './instrument.js';

/** How far `--replay-through` freezes the pipeline. */
export type ReplayThrough = 'select' | 'actions' | 'layout';

export const REPLAY_THROUGH: readonly ReplayThrough[] = [
  'select',
  'actions',
  'layout',
];

/** What one Jev turn recorded, as written under `<out>/stages/<arm>/`. */
export interface StageFile {
  readonly arm: string;
  readonly scenarioId: string;
  readonly repeat: number;
  readonly stages: readonly StageRecord[];
}

/** One recorded turn; `stages` is absent when the source run has no such turn. */
export interface TurnCache {
  /** `<scenarioId> #<repeat>`, for error messages. */
  readonly key: string;
  readonly stages?: readonly StageRecord[];
}

export interface ReplaySource {
  readonly dir: string;
  turn(scenarioId: string, repeat: number): TurnCache;
}

const ORDER: readonly StageName[] = ['jevSelect', 'jevActions', 'jevLayout'];

/** The stages `--replay-through <through>` replays, in pipeline order. */
export function replayedStages(through: ReplayThrough): readonly StageName[] {
  return ORDER.slice(0, REPLAY_THROUGH.indexOf(through) + 1);
}

/**
 * A stage that returns what stage `name` returned in the recorded turn: its
 * output, or the same deferral. Throws when the turn recorded no such stage
 * or the stage failed there, since there is nothing faithful to replay.
 */
export function replayStage(
  name: StageName,
  cache: TurnCache,
): Stage<unknown, unknown> {
  return async () => {
    const record = cache.stages?.find((entry) => entry.stage === name);
    if (record === undefined)
      throw new Error(`replay: no recorded ${name} for ${cache.key}`);
    if (record.outcome === 'ok') return ok(record.output);
    if (record.outcome === 'deferred' && record.reason !== undefined)
      return err(deferred(record.reason));
    throw new Error(
      `replay: recorded ${name} for ${cache.key} failed with ${record.errorTag ?? 'an error'}`,
    );
  };
}

/** Writes one turn's stage records and returns the file's path. */
export async function writeStageFile(
  out: string,
  file: StageFile,
): Promise<string> {
  const dir = join(out, 'stages', file.arm);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${file.scenarioId}-${file.repeat}.json`);
  await writeFile(path, JSON.stringify(file, null, 2));
  return path;
}

/** Loads every turn `arm` recorded in the run written to `out`. */
export async function loadReplay(
  out: string,
  arm: string,
): Promise<ReplaySource> {
  const dir = join(out, 'stages', arm);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  } catch {
    names = [];
  }
  if (names.length === 0)
    throw new Error(`replay: no recorded stages in ${dir}`);
  const turns = new Map<string, readonly StageRecord[]>();
  for (const name of names) {
    const file = JSON.parse(
      await readFile(join(dir, name), 'utf8'),
    ) as StageFile;
    turns.set(turnKey(file.scenarioId, file.repeat), file.stages);
  }
  return {
    dir,
    turn: (scenarioId, repeat) => {
      const key = turnKey(scenarioId, repeat);
      const stages = turns.get(key);
      return stages === undefined ? { key } : { key, stages };
    },
  };
}

function turnKey(scenarioId: string, repeat: number): string {
  return `${scenarioId} #${repeat}`;
}
