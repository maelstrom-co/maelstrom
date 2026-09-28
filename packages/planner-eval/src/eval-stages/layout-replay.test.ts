import { describe, expect, test } from 'bun:test';

import {
  isDeferred,
  type PlanningInput,
  type StageContext,
} from '@maelstrom-co/engine';
import {
  type ComposedPairsDecision,
  type GatedActionPlan,
  layoutComposedPairsGateAndDefer,
} from '@maelstrom-co/planner-jev/_internal';
import {
  demoTurnPlan,
  loadDemoTurns,
  type ReplayAnswers,
  recordedAsk,
} from '@maelstrom-co/planner-jev/_testing';
import { isOk, type TilingNode } from '@maelstrom-co/protocol';
import { type Scenario, scenarios } from '../eval/scenarios.js';
import { loadStageEvalTurns } from './fixtures/stage-eval-turns.js';
import { judgeLayout, layoutStageEval } from './layout.js';
import { planningInput } from './stage-eval.js';

const HOLDOUT_FOCUS_KEPT_ROW = [
  'V:9,3,2',
  'ID:calendar-main',
  'ID:weather-main',
  'ID:tasks-main',
] as TilingNode[];

const HOLDOUT_KEEP_ROW_TASKS_BESIDE_WEATHER = [
  'V:5,2',
  'H',
  'V',
  'ID:weather-main',
  'ID:tasks-main',
  'ID:calendar-main',
  'ID:journal-main',
] as TilingNode[];

const MAP_FULL_WIDTH_UNDER_KEPT_ROW = [
  'H:3,2',
  'V:1,1,1',
  'ID:calendar-main',
  'ID:weather-main',
  'ID:tasks-main',
  'ID:map-main',
] as TilingNode[];

const HOLDOUT_BANNER_OVER_ROW = [
  'H:2,3',
  'ID:map-main',
  'V:1,1,1',
  'ID:calendar-main',
  'ID:weather-main',
  'ID:tasks-main',
] as TilingNode[];

const INTENDED_TREE_CHANGES: Readonly<
  Record<string, readonly TilingNode[] | null>
> = {
  'log1:25': ['H:1,3', 'ID:map-jev-1', 'ID:journal-main'] as TilingNode[],
  'log2:10': [
    'H:3,1',
    'V:2,1',
    'H',
    'ID:calendar-main',
    'ID:tasks-main',
    'ID:map-jev-1',
    'ID:weather-jev-1',
  ] as TilingNode[],
  'combined-holdout/hold-arr-focus#1': HOLDOUT_FOCUS_KEPT_ROW,
  'combined-holdout/hold-arr-focus#2': HOLDOUT_FOCUS_KEPT_ROW,
  'combined-holdout/hold-arr-focus#3': HOLDOUT_FOCUS_KEPT_ROW,
  'log1:11': [
    'H:3,1',
    'V',
    'H',
    'ID:calendar-main',
    'ID:tasks-main',
    'ID:map-jev-1',
    'ID:weather-main',
  ] as TilingNode[],
  'log1:13': [
    'H:5,2',
    'V:6,2,1',
    'ID:calendar-main',
    'ID:tasks-main',
    'H',
    'ID:journal-main',
    'ID:map-jev-1',
    'ID:weather-main',
  ] as TilingNode[],
  'combined-holdout/hold-fresh-keep-row-move-single#1':
    HOLDOUT_KEEP_ROW_TASKS_BESIDE_WEATHER,
  'combined-holdout/hold-fresh-keep-row-move-single#2':
    HOLDOUT_KEEP_ROW_TASKS_BESIDE_WEATHER,
  'combined-holdout/hold-fresh-keep-row-move-single#3':
    HOLDOUT_KEEP_ROW_TASKS_BESIDE_WEATHER,
  'log1:15': [
    'V:1,3',
    'ID:calendar-main',
    'H:3,1',
    'V:2,1,2',
    'ID:tasks-main',
    'ID:journal-main',
    'ID:map-jev-1',
    'ID:weather-main',
  ] as TilingNode[],
  'log1:16': [
    'V:1,1,1,4',
    'ID:calendar-main',
    'ID:tasks-main',
    'ID:journal-main',
    'H',
    'ID:map-jev-1',
    'ID:weather-main',
  ] as TilingNode[],
  'combined/map-full-width-bottom#1': MAP_FULL_WIDTH_UNDER_KEPT_ROW,
  'combined/map-full-width-bottom#2': MAP_FULL_WIDTH_UNDER_KEPT_ROW,
  'combined/map-full-width-bottom#3': MAP_FULL_WIDTH_UNDER_KEPT_ROW,
  'gold/map-full-width-bottom#1': MAP_FULL_WIDTH_UNDER_KEPT_ROW,
  'gold/map-full-width-bottom#2': MAP_FULL_WIDTH_UNDER_KEPT_ROW,
  'gold/map-full-width-bottom#3': MAP_FULL_WIDTH_UNDER_KEPT_ROW,
  'combined-holdout/hold-arr-banner#1': [
    'H:1,2',
    'ID:map-main',
    'V:1,1,1',
    'ID:calendar-main',
    'ID:weather-main',
    'ID:tasks-main',
  ] as TilingNode[],
  'combined-holdout/hold-arr-banner#2': HOLDOUT_BANNER_OVER_ROW,
  'combined-holdout/hold-arr-banner#3': HOLDOUT_BANNER_OVER_ROW,
  'combined-holdout/hold-inner-two-thirds-of-row#1': [
    'H:2,1',
    'V:9,3,2',
    'ID:calendar-main',
    'ID:weather-main',
    'ID:tasks-main',
    'ID:map-main',
  ] as TilingNode[],
};

const STAGE_EVAL_TURNS = 401;
const DEMO_TURNS = 34;

type Shipped = readonly TilingNode[] | null | string;

interface Mismatch {
  readonly key: string;
  readonly expected: Shipped;
  readonly actual: Shipped;
}

const stageEvalTurns = await loadStageEvalTurns();
const demoTurns = await loadDemoTurns();

describe('layout stage replay of recorded Jev answers', () => {
  test('covers every recorded turn once', () => {
    const keys = [...stageEvalTurns, ...demoTurns].map(({ key }) => key);
    expect(stageEvalTurns.length).toBe(STAGE_EVAL_TURNS);
    expect(demoTurns.length).toBe(DEMO_TURNS);
    expect(new Set(keys).size).toBe(keys.length);
    const stale = Object.keys(INTENDED_TREE_CHANGES).filter(
      (key) => !keys.includes(key),
    );
    expect(stale).toEqual([]);
  });

  test('ships the recorded or intended tree on every stage-eval turn, and passes wherever the recorded tree passed', async () => {
    const mismatches: Mismatch[] = [];
    const lostPasses: string[] = [];
    const inputs = new Map<string, PreparedTurnInput>();
    for (const turn of stageEvalTurns) {
      const scenario = scenarioById(turn.scenarioId);
      const input =
        inputs.get(scenario.id) ?? (await preparedTurnInput(scenario));
      inputs.set(scenario.id, input);
      const actual = await replay(input.plan, input.ctx, turn.answers);
      const expected = expectedTree(turn.key, turn.recordedTree);
      if (!sameShipped(actual, expected))
        mismatches.push({ key: turn.key, expected, actual });
      if (
        turn.recordedTree !== null &&
        passes(scenario, input.plan, turn.recordedTree) &&
        !(Array.isArray(actual) && passes(scenario, input.plan, actual))
      )
        lostPasses.push(turn.key);
    }
    expect(mismatches).toEqual([]);
    expect(lostPasses).toEqual([]);
  });

  test('ships the recorded or intended tree on every demo turn', async () => {
    const mismatches: Mismatch[] = [];
    for (const turn of demoTurns) {
      const plan = demoTurnPlan(turn);
      const actual = await replay(
        plan,
        contextFor(plan.selection.input),
        turn.answers,
      );
      const expected = expectedTree(turn.key, turn.recordedTree);
      if (!sameShipped(actual, expected))
        mismatches.push({ key: turn.key, expected, actual });
    }
    expect(mismatches).toEqual([]);
  });
});

describe('close calls the size check leaves to a lower tree that fits as sized', () => {
  test('keeps the right stack when rank 0 is only 0.02 nats ahead and does not fit as sized', async () => {
    for (const key of ['combined/focus#1', 'gold/focus#2']) {
      const decision = await replayStageEvalTurn(key);
      expect(decision.pairwise.chosen).toBe(1);
      expect(decision.tree).toEqual([
        'V:2,1',
        'ID:calendar-main',
        'H',
        'ID:weather-main',
        'ID:tasks-main',
      ]);
    }
  });

  test('keeps the narrow stacked pair when rank 0 is 1.2 nats ahead', async () => {
    for (const key of [
      'gold/narrow-pair-stacked-triple#1',
      'gold/narrow-pair-stacked-triple#2',
    ]) {
      const decision = await replayStageEvalTurn(key);
      expect(decision.pairwise.chosen).toBe(1);
      expect(decision.tree).toEqual([
        'V:1,4',
        'H',
        'ID:calendar-main',
        'ID:tasks-main',
        'H:1,1,2',
        'ID:map-main',
        'ID:weather-main',
        'ID:journal-main',
      ]);
    }
  });
});

interface PreparedTurnInput {
  readonly plan: GatedActionPlan;
  readonly ctx: StageContext;
}

const SILENT = { debug() {}, info() {}, warn() {}, error() {} };

function scenarioById(id: string): Scenario {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined) throw new Error(`no scenario ${id}`);
  return scenario;
}

async function preparedTurnInput(
  scenario: Scenario,
): Promise<PreparedTurnInput> {
  const ctx = contextFor(planningInput(scenario));
  const prepared = await layoutStageEval.prepare(scenario, ctx);
  if (!prepared.applicable)
    throw new Error(`${scenario.id}: ${prepared.reason}`);
  return { plan: prepared.input, ctx };
}

function contextFor(origin: PlanningInput): StageContext {
  return {
    origin,
    logger: SILENT,
    validate: () => {
      throw new Error('the layout stage validates no candidate');
    },
  };
}

async function replay(
  plan: GatedActionPlan,
  ctx: StageContext,
  answers: ReplayAnswers,
): Promise<Shipped> {
  const result = await layoutComposedPairsGateAndDefer(recordedAsk(answers))(
    plan,
    ctx,
  );
  if (isOk(result)) return result.value.tree ?? 'handed off';
  return isDeferred(result.error) ? null : `error: ${result.error._tag}`;
}

function expectedTree(
  key: string,
  recordedTree: readonly TilingNode[] | null,
): Shipped {
  return Object.hasOwn(INTENDED_TREE_CHANGES, key)
    ? (INTENDED_TREE_CHANGES[key] ?? null)
    : recordedTree;
}

function sameShipped(actual: Shipped, expected: Shipped): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function passes(
  scenario: Scenario,
  plan: GatedActionPlan,
  tree: readonly TilingNode[],
): boolean {
  return (
    judgeLayout(scenario, plan, { plan, source: 'jev', tree, answers: [] })
      .outcome === 'pass'
  );
}

async function replayStageEvalTurn(
  key: string,
): Promise<ComposedPairsDecision> {
  const turn = stageEvalTurns.find((candidate) => candidate.key === key);
  if (turn === undefined) throw new Error(`no stage-eval turn ${key}`);
  const { plan, ctx } = await preparedTurnInput(scenarioById(turn.scenarioId));
  const result = await layoutComposedPairsGateAndDefer(
    recordedAsk(turn.answers),
  )(plan, ctx);
  if (!isOk(result)) throw new Error(`${key} did not plan`);
  return result.value;
}
