import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { deferred, type Stage } from '@maelstrom-co/engine';
import type { StageName } from '@maelstrom-co/planner-jev/_internal';
import { err, ok } from '@maelstrom-co/protocol';
import type { StageRecord } from './instrument.js';
import type { Scenario } from './scenarios.js';

/** How far `--replay-through` freezes the pipeline. */
export type ReplayThrough = 'select' | 'actions' | 'layout';

const LAST_REPLAYED: Readonly<Record<ReplayThrough, StageName>> = {
  select: 'jevSelect',
  actions: 'jevActions',
  layout: 'jevLayout',
};

/** Every `--replay-through` value, in pipeline order. */
export const REPLAY_THROUGH = Object.keys(
  LAST_REPLAYED,
) as readonly ReplayThrough[];

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
  /** The directory the recorded turns were loaded from. */
  readonly dir: string;
  turn(scenarioId: string, repeat: number): TurnCache;
}

/** The stages `--replay-through <through>` replays, in pipeline order. */
export function replayedStages(through: ReplayThrough): readonly StageName[] {
  const order = Object.values(LAST_REPLAYED);
  return order.slice(0, order.indexOf(LAST_REPLAYED[through]) + 1);
}

/**
 * Checks, before anything runs, that `source` recorded every scenario and
 * repeat to be replayed, from the same request and history. The first
 * stage's recorded input is compared with the scenario; its `messageId` and
 * `sessionId` are ignored, since they name the arm that recorded it.
 *
 * @throws {Error} Naming `source.dir` and every mismatched turn with its reason.
 */
export function verifyReplay(
  source: ReplaySource,
  scenarios: readonly Scenario[],
  repeats: number,
): void {
  const problems: string[] = [];
  for (const scenario of scenarios)
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const turn = source.turn(scenario.id, repeat);
      const reasons = mismatches(scenario, turn.stages);
      problems.push(...reasons.map((reason) => `- ${turn.key}: ${reason}`));
    }
  if (problems.length > 0)
    throw new Error(
      [
        `replay: the recording in ${source.dir} does not match the scenarios to run:`,
        ...problems,
      ].join('\n'),
    );
}

/**
 * What an arm's stages read from a replayed stage's output. `poc` reads
 * only the POC's fields. `ungated` also reads `minConfidence` on the action
 * plan, and would act on gates it never asked for, so a recording with
 * gates is refused. `gated` reads every gate on the selection and the
 * action plan.
 */
export type ReplayShape = 'poc' | 'ungated' | 'gated';

/** An arm as {@link verifyReplayShape} sees it. */
export interface ReplayingArm {
  readonly name: string;
  /** Defaults to `poc`. */
  readonly replayShape?: ReplayShape;
}

/**
 * Checks, before anything runs, that every replayed stage output of every
 * turn has the fields each arm reads from it.
 *
 * @throws {Error} Naming `source.dir`, and per arm and problem the turns it affects.
 */
export function verifyReplayShape(
  source: ReplaySource,
  scenarios: readonly Scenario[],
  repeats: number,
  stages: readonly StageName[],
  arms: readonly ReplayingArm[],
): void {
  const problems = new Map<string, string[]>();
  for (const arm of arms) {
    const shape = arm.replayShape ?? 'poc';
    if (shape === 'poc') continue;
    for (const scenario of scenarios)
      for (let repeat = 1; repeat <= repeats; repeat++) {
        const turn = source.turn(scenario.id, repeat);
        for (const record of turn.stages ?? []) {
          if (!stages.includes(record.stage) || record.outcome !== 'ok')
            continue;
          for (const problem of shapeProblems(shape, record)) {
            const key = `${arm.name}: ${record.stage} ${problem}`;
            problems.set(key, [...(problems.get(key) ?? []), turn.key]);
          }
        }
      }
  }
  if (problems.size > 0)
    throw new Error(
      [
        `replay: the recording in ${source.dir} lacks what these arms read:`,
        ...[...problems].map(
          ([problem, turns]) =>
            `- ${problem} (${turns.length} turns: ${turns.slice(0, 3).join(', ')}${turns.length > 3 ? ', ...' : ''})`,
        ),
      ].join('\n'),
    );
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
  } catch (error) {
    if (!isNotFound(error)) throw unreadable(dir, error);
    names = [];
  }
  if (names.length === 0)
    throw new Error(`replay: no recorded stages in ${dir}`);
  const turns = new Map<string, readonly StageRecord[]>();
  for (const name of names) {
    const path = join(dir, name);
    let file: StageFile;
    try {
      file = JSON.parse(await readFile(path, 'utf8')) as StageFile;
    } catch (error) {
      throw unreadable(path, error);
    }
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

function mismatches(
  scenario: Scenario,
  stages: readonly StageRecord[] | undefined,
): string[] {
  if (stages === undefined || stages.length === 0) return ['no recorded turn'];
  const first = stages.find((record) => record.stage === 'jevSelect');
  if (first === undefined) return ['no recorded jevSelect'];
  const recorded = (first.input ?? {}) as {
    readonly request?: unknown;
    readonly history?: unknown;
  };
  const reasons: string[] = [];
  if (!sameJson(scenario.request, recorded.request))
    reasons.push('request differs');
  if (!sameJson(scenario.history ?? [], recorded.history))
    reasons.push('history differs');
  return reasons;
}

const GATES = ['needsActions', 'generatedContent', 'spatial'] as const;

function shapeProblems(shape: ReplayShape, record: StageRecord): string[] {
  const output = (record.output ?? {}) as {
    readonly gates?: Readonly<Record<string, unknown>>;
    readonly minConfidence?: unknown;
  };
  const problems: string[] = [];
  if (record.stage === 'jevActions' && typeof output.minConfidence !== 'number')
    problems.push('has no minConfidence');
  if (record.stage !== 'jevSelect' && record.stage !== 'jevActions')
    return problems;
  if (shape === 'ungated' && output.gates !== undefined)
    problems.push('carries gates this ungated arm would act on');
  if (shape === 'gated' && !GATES.every((gate) => isGate(output.gates?.[gate])))
    problems.push('has no complete gates');
  return problems;
}

function isGate(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const gate = value as Record<string, unknown>;
  return (
    (gate.answer === 'yes' || gate.answer === 'no') &&
    typeof gate.probability === 'number' &&
    typeof gate.confidence === 'number'
  );
}

function sameJson(live: unknown, recorded: unknown): boolean {
  return Bun.deepEquals(JSON.parse(JSON.stringify(live)), recorded);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function unreadable(path: string, cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new Error(`replay: cannot read ${path}: ${reason}`, { cause });
}

function turnKey(scenarioId: string, repeat: number): string {
  return `${scenarioId} #${repeat}`;
}
