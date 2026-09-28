import { readFile } from 'node:fs/promises';

import {
  ChartRequestSchema,
  InstanceId,
  MessageId,
  ok,
  SessionId,
  type TilingNode,
  type UpdateReason,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import { demoVessels } from '../../../eval/fixtures/demo-vessels.js';
import type { Answer } from '../questions.js';
import { GATE_THRESHOLD } from '../stages/select-gated.js';
import type { GateAnswer, GatedActionPlan } from '../stages/stage-types.js';
import type { SelectedInstance } from '../types.js';
import type { Ask } from '../typesafe-client.js';

/** One recorded Jev answer, trimmed to what the layout stage reads; options with probability 0 are left out. */
export interface ReplayAnswer {
  /** The chosen option, the most probable level of a score answer, or `yes` or `no`. */
  readonly choice: string;
  /** The confidence Jev reported. */
  readonly confidence: number;
  /** The fractional position along the levels; score answers only. */
  readonly score?: number;
  /** The probability of yes; yes/no answers only. */
  readonly probability?: number;
  /** Probability per option, level number string, or `yes` and `no`. */
  readonly probabilities: Readonly<Record<string, number>>;
}

/** Recorded answers by question id, as one layout call returned them. */
export type ReplayAnswers = Readonly<Record<string, ReplayAnswer>>;

/** A layout stage-eval turn recorded against a scenario's gold input. */
export interface StageEvalReplayTurn {
  /** `<run>/<scenarioId>#<repeat>`, the run being `combined`, `combined-holdout` or `gold`. */
  readonly key: string;
  /** The id of the scenario in `eval/scenarios.ts` whose gold input the turn ran on. */
  readonly scenarioId: string;
  /** Which repeat of the scenario the turn was, from 1. */
  readonly repeat: number;
  /** The tree the stage shipped, or `null` when it deferred. */
  readonly recordedTree: readonly TilingNode[] | null;
  /** The answers of the turn's layout call. */
  readonly answers: ReplayAnswers;
}

/** An Instance of a logged demo turn, as the layout stage saw it. */
export interface DemoReplayInstance {
  /** The Instance's id. */
  readonly instanceId: string;
  /** The id of the Vessel in `eval/fixtures/demo-vessels.ts` the Instance renders. */
  readonly vesselId: string;
  /** The variant the layout stage sized the Instance with. */
  readonly variant: string;
  /** Whether the Instance was visible to the layout stage. */
  readonly visible: boolean;
  /** Whether the select stage created the Instance this turn. */
  readonly fresh: boolean;
}

/** A layout turn logged by the demo app. */
export interface DemoReplayTurn {
  /** `<log>:<turn number>`, for example `log2:10`. */
  readonly key: string;
  /** Why the demo app sent the request: the user's words or a Chart resize. */
  readonly updateReasons: readonly UpdateReason[];
  /** The Chart size in grid cells. */
  readonly chart: { readonly columns: number; readonly rows: number };
  /** The tree on the Chart before the turn. */
  readonly currentTree: readonly TilingNode[];
  /** Every Instance the select stage returned, in its order; created Instances last. */
  readonly instances: readonly DemoReplayInstance[];
  /** The probability of yes the select stage answered for the `spatial` gate. */
  readonly spatialProbability: number;
  /** The tree the planner shipped. */
  readonly recordedTree: readonly TilingNode[];
  /** The answers of the turn's layout call. */
  readonly answers: ReplayAnswers;
}

/** Every recorded layout stage-eval turn. */
export async function loadStageEvalTurns(): Promise<
  readonly StageEvalReplayTurn[]
> {
  return (await readFixture(
    'stage-eval-turns.json',
  )) as readonly StageEvalReplayTurn[];
}

/** Every logged demo layout turn, in log and turn order. */
export async function loadDemoTurns(): Promise<readonly DemoReplayTurn[]> {
  return (await readFixture('demo-turns.json')) as readonly DemoReplayTurn[];
}

/** The logged demo turn with `key`, such as `log2:10`. */
export async function demoTurn(key: string): Promise<DemoReplayTurn> {
  const turn = (await loadDemoTurns()).find(
    (candidate) => candidate.key === key,
  );
  if (turn === undefined) throw new Error(`no demo turn ${key}`);
  return turn;
}

/** An {@link Ask} that answers every call with `answers` and no token usage. */
export function recordedAsk(answers: ReplayAnswers): Ask {
  return async () =>
    ok({
      answers: answers as Readonly<Record<string, Answer>>,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
}

/**
 * The layout stage's input for a logged demo turn: the demo Vessels, the
 * turn's Instances, current tree, Chart size and update reasons, no
 * actions, and every gate `no` except `spatial`, which is the logged one.
 */
export function demoTurnPlan(turn: DemoReplayTurn): GatedActionPlan {
  const existing = turn.instances
    .filter((instance) => !instance.fresh)
    .map(snapshot);
  const request = ChartRequestSchema.parse({
    type: 'chart_request',
    context: {
      layoutMode: 'tiling',
      chartDimensions: turn.chart,
      updateReasons: turn.updateReasons,
    },
    instances: existing,
    vessels: demoVessels,
    layout: { type: 'tiling', tree: turn.currentTree, instances: existing },
  });
  const instances: SelectedInstance[] = turn.instances.map((instance) => ({
    ...snapshot(instance),
    visible: instance.visible,
    fresh: instance.fresh,
    decision: instance.fresh ? 'create' : instance.visible ? 'keep' : 'hide',
  }));
  const gates = {
    needsActions: NO,
    generatedContent: NO,
    spatial: gateAnswer(turn.spatialProbability),
  };
  const selection = {
    input: {
      messageId: MessageId(`replay-${turn.key}`),
      sessionId: SessionId('layout-replay'),
      request,
      history: [],
    },
    instances,
    answers: [],
    gates,
  };
  return {
    selection,
    actions: [],
    asks: [],
    answers: [],
    minConfidence: 1,
    gates,
  };
}

const FIXTURES = new URL('./layout-replay-fixtures/', import.meta.url);

const NO: GateAnswer = { answer: 'no', probability: 0, confidence: 1 };

async function readFixture(name: string): Promise<unknown[]> {
  const parsed: unknown = JSON.parse(
    await readFile(new URL(name, FIXTURES), 'utf8'),
  );
  if (!Array.isArray(parsed)) throw new Error(`${name} holds no list of turns`);
  return parsed;
}

function snapshot(
  instance: DemoReplayInstance,
): Pick<SelectedInstance, 'instanceId' | 'vesselId' | 'variant'> {
  return {
    instanceId: InstanceId(instance.instanceId),
    vesselId: VesselId(instance.vesselId),
    variant: VariantName(instance.variant),
  };
}

function gateAnswer(probability: number): GateAnswer {
  return {
    answer: probability >= GATE_THRESHOLD ? 'yes' : 'no',
    probability,
    confidence: Math.abs(2 * probability - 1),
  };
}
