import {
  llmPlanner,
  type Planner,
  type PlannerCandidate,
  type PlanningInput,
  type Retryable,
  type Stage,
  withRetry,
} from '@maelstrom-co/engine';
import type { AnyTextAdapter } from '@tanstack/ai';
import { layoutComposedPairsBothFixes } from '../eval-stages/layout.js';
import {
  buildJevPlanner,
  FALLBACK_RETRIES,
  type Instrument,
} from '../src/lib/jev-planner.js';
import { buildJevGatedBatchedPlanner } from '../src/lib/planners/jev-gated-batched.js';
import { buildJevGatedStepwisePlanner } from '../src/lib/planners/jev-gated-stepwise.js';
import {
  buildJevStagePlanner,
  type JevStages,
} from '../src/lib/planners/jev-stage-planner.js';
import { buildJevUngatedBatchedPlanner } from '../src/lib/planners/jev-ungated-batched.js';
import { buildJevUngatedBatchedPerInstancePlanner } from '../src/lib/planners/jev-ungated-batched-per-instance.js';
import { buildJevUngatedStepwisePlanner } from '../src/lib/planners/jev-ungated-stepwise.js';
import { actionsBatchedPerInstance } from '../src/lib/stages-experimental/actions-batched-per-instance.js';
import { completeLayoutInline } from '../src/lib/stages-experimental/complete-layout-inline.js';
import { completeLayoutParallel } from '../src/lib/stages-experimental/complete-layout-parallel.js';
import {
  createJevDeps,
  type JevDeps,
} from '../src/lib/stages-experimental/deps.js';
import { layoutAlwaysLlm } from '../src/lib/stages-experimental/layout-always-llm.js';
import { layoutComposed } from '../src/lib/stages-experimental/layout-composed.js';
import { layoutPreset } from '../src/lib/stages-experimental/layout-preset.js';
import { layoutPresetOrLlm } from '../src/lib/stages-experimental/layout-preset-or-llm.js';
import { layoutSpatialGate } from '../src/lib/stages-experimental/layout-spatial-gate.js';
import { selectGated } from '../src/lib/stages-experimental/select-gated.js';
import { selectUngated } from '../src/lib/stages-experimental/select-ungated.js';
import type { Selection2 } from '../src/lib/stages-experimental/types.js';
import type { TypeSafeClientOptions } from '../src/lib/typesafe-client.js';
import type { ReplayShape } from './replay.js';
import type { LlmRole } from './usage-adapter.js';

/** `baseline` is the LLM planner, `jev-poc` the frozen POC, `jev` any later Jev planner. */
export type ArmKind = 'baseline' | 'jev-poc' | 'jev';

/** What the runner hands every arm for one turn. */
export interface ArmDeps {
  /** TypeSafe settings, with the turn's `onCall` recorder. */
  readonly typesafe: TypeSafeClientOptions;
  /** The text adapter for one LLM role, recording that role's calls. */
  readonly adapter: (role: LlmRole) => AnyTextAdapter;
  /** The unwrapped fallback planner, counted by the runner. */
  readonly fallback: Stage<Retryable<PlanningInput>, PlannerCandidate>;
  /** Wraps every Jev stage, for recording and replay. */
  readonly instrument: Instrument;
}

export interface Arm {
  readonly name: string;
  readonly kind: ArmKind;
  readonly build: (deps: ArmDeps) => Planner;
  /** What the arm reads from replayed stage outputs; `poc` when absent. */
  readonly replayShape?: ReplayShape;
}

/** The demo's system rules (apps/demo/src/server/engine-config.ts), so every arm prompts the LLM like the demo. */
export const SYSTEM_RULES = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content`;

const GATED_PER_INSTANCE = {
  select: selectGated,
  actions: actionsBatchedPerInstance,
} as const;

const ARMS: readonly Arm[] = [
  {
    name: 'baseline',
    kind: 'baseline',
    build: (deps) =>
      withRetry(demoLlmPlanner(deps.adapter('planner')), {
        max: FALLBACK_RETRIES,
      }),
  },
  {
    name: 'jev-poc',
    kind: 'jev-poc',
    build: (deps) =>
      buildJevPlanner(
        {
          typesafe: deps.typesafe,
          adapter: deps.adapter('complete'),
          fallback: deps.fallback,
        },
        deps.instrument,
      ),
  },
  stageLibraryArm(
    'jev-ungated-stepwise-preset-inline',
    'ungated',
    buildJevUngatedStepwisePlanner,
  ),
  stageLibraryArm(
    'jev-ungated-batched-preset-inline',
    'ungated',
    buildJevUngatedBatchedPlanner,
  ),
  stageLibraryArm(
    'jev-ungated-per-instance-preset-inline',
    'ungated',
    buildJevUngatedBatchedPerInstancePlanner,
  ),
  stageLibraryArm(
    'jev-gated-stepwise-preset-inline',
    'gated',
    buildJevGatedStepwisePlanner,
  ),
  stageLibraryArm(
    'jev-gated-batched-preset-inline',
    'gated',
    buildJevGatedBatchedPlanner,
  ),
  stagePlannerArm('jev-gated-per-instance-preset-inline', 'gated', {
    ...GATED_PER_INSTANCE,
    layout: (ask) => layoutPreset(ask, { describe: 'placements' }),
    complete: completeLayoutInline,
  }),
  stagePlannerArm('jev-gated-per-instance-preset-or-llm-inline', 'gated', {
    ...GATED_PER_INSTANCE,
    layout: layoutPresetOrLlm,
    complete: completeLayoutInline,
  }),
  stagePlannerArm('jev-gated-per-instance-preset-or-llm-parallel', 'gated', {
    ...GATED_PER_INSTANCE,
    layout: layoutPresetOrLlm,
    complete: completeLayoutParallel,
  }),
  stagePlannerArm('jev-gated-per-instance-spatial-gate-inline', 'gated', {
    ...GATED_PER_INSTANCE,
    layout: layoutSpatialGate,
    complete: completeLayoutInline,
  }),
  stagePlannerArm('jev-gated-per-instance-spatial-gate-parallel', 'gated', {
    ...GATED_PER_INSTANCE,
    layout: layoutSpatialGate,
    complete: completeLayoutParallel,
  }),
  stagePlannerArm('jev-gated-per-instance-composed-inline', 'gated', {
    ...GATED_PER_INSTANCE,
    layout: (ask) => layoutComposed(ask),
    complete: completeLayoutInline,
  }),
  stagePlannerArm('jev-gated-per-instance-composed-parallel', 'gated', {
    ...GATED_PER_INSTANCE,
    layout: (ask) => layoutComposed(ask),
    complete: completeLayoutParallel,
  }),
  stagePlannerArm(
    'jev-gated-per-instance-composed-2-size-levels-inline',
    'gated',
    {
      ...GATED_PER_INSTANCE,
      layout: (ask) => layoutComposed(ask, { sizeLevels: 2 }),
      complete: completeLayoutInline,
    },
  ),
  stagePlannerArm('jev-gated-per-instance-composed-pairs-inline', 'gated', {
    ...GATED_PER_INSTANCE,
    layout: layoutComposedPairsBothFixes,
    complete: completeLayoutInline,
  }),
  stagePlannerArm('jev-gated-per-instance-composed-pairs-parallel', 'gated', {
    ...GATED_PER_INSTANCE,
    layout: layoutComposedPairsBothFixes,
    complete: completeLayoutParallel,
  }),
  stagePlannerArm('jev-gated-per-instance-always-llm-inline', 'gated', {
    ...GATED_PER_INSTANCE,
    layout: layoutAlwaysLlm,
    complete: completeLayoutInline,
  }),
  stagePlannerArm('jev-gated-per-instance-always-llm-parallel', 'gated', {
    ...GATED_PER_INSTANCE,
    layout: layoutAlwaysLlm,
    complete: completeLayoutParallel,
  }),
  stagePlannerArm('jev-ungated-per-instance-preset-or-llm-inline', 'ungated', {
    select: selectUngated,
    actions: actionsBatchedPerInstance,
    layout: layoutPresetOrLlm,
    complete: completeLayoutInline,
  }),
];

/** Every arm the runner knows, by name. */
export const arms: Readonly<Record<string, Arm>> = armRegistry(ARMS);

/**
 * Indexes `list` by name.
 *
 * @throws {Error} When two arms share a name.
 */
export function armRegistry(
  list: readonly Arm[],
): Readonly<Record<string, Arm>> {
  const registry: Record<string, Arm> = {};
  for (const arm of list) {
    if (Object.hasOwn(registry, arm.name))
      throw new Error(`arm ${arm.name} is registered twice`);
    registry[arm.name] = arm;
  }
  return registry;
}

/** Arms run when `--arm` is not given. */
export const DEFAULT_ARMS: readonly string[] = ['baseline', 'jev-poc'];

const ALIASES: Readonly<Record<string, string>> = { jev: 'jev-poc' };

/**
 * The arms named, in the order given. Aliases resolve to their arm, and a
 * name repeated (directly or through an alias) keeps its first position:
 * two columns of the same arm would share one output directory.
 *
 * @throws {Error} On an unknown name or an empty list.
 */
export function resolveArms(names: readonly string[]): readonly Arm[] {
  if (names.length === 0) throw new Error('name at least one arm');
  const resolved: Arm[] = [];
  for (const name of names) {
    const arm = arms[ALIASES[name] ?? name];
    if (arm === undefined)
      throw new Error(`unknown arm ${name}; known arms: ${known()}`);
    if (!resolved.includes(arm)) resolved.push(arm);
  }
  return resolved;
}

/** The LLM planner every arm uses as its baseline or fallback, prompted like the demo. */
export function demoLlmPlanner(adapter: AnyTextAdapter) {
  return llmPlanner({
    adapter,
    prompt: { system: { rules: { append: SYSTEM_RULES } } },
  });
}

/** The stage library's dependencies for one turn, with the completion call on the `complete` role. */
export function jevDeps(deps: ArmDeps): JevDeps {
  return createJevDeps({
    typesafe: deps.typesafe,
    adapter: deps.adapter('complete'),
    fallback: deps.fallback,
  });
}

function stageLibraryArm(
  name: string,
  replayShape: ReplayShape,
  build: (deps: JevDeps, instrument: Instrument) => Planner,
): Arm {
  return {
    name,
    kind: 'jev',
    replayShape,
    build: (deps) => build(jevDeps(deps), deps.instrument),
  };
}

function stagePlannerArm<Selected extends Selection2>(
  name: string,
  replayShape: ReplayShape,
  stages: JevStages<Selected>,
): Arm {
  return stageLibraryArm(name, replayShape, (deps, instrument) =>
    buildJevStagePlanner(stages, deps, instrument),
  );
}

function known(): string {
  return Object.keys(arms)
    .map((name) => {
      const aliases = Object.entries(ALIASES)
        .filter(([, target]) => target === name)
        .map(([alias]) => alias);
      return aliases.length > 0
        ? `${name} (alias ${aliases.join(', ')})`
        : name;
    })
    .join(', ');
}
