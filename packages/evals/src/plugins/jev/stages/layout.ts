import { finalVariants, type Stage } from '@maelstrom-co/engine';
import {
  type AnswerRecord,
  type Ask,
  type ComposedPairsRecord,
  createTypeSafeClient,
  type GateAnswer,
  type GatedActionPlan,
  type LayoutDecision,
  type LayoutSource,
  layoutComposedPairsGateAndDefer,
  layoutFits,
  layoutPreset,
  layoutPresetOrLlm,
  STAGE_NAME,
} from '@maelstrom-co/planner-jev/_internal';
import {
  getVisibleInstanceIds,
  isErr,
  type TilingNode,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { checkArrangement } from '../../../core/predicates.js';
import type { Scenario } from '../../../core/scenarios.js';
import { scoreLayout } from '../../../core/score.js';
import type { Judgement, StageEvalModule } from '../../../core/stage-eval.js';
import { jevArms } from '../arms.js';
import { goldInputs, layoutDeferralGoldInputs } from '../gold-inputs.js';
import {
  renderArrangementNotAskedSection,
  renderComposedPairsSection,
} from '../layout-report.js';
import {
  checkPairAnswers,
  type PairsAnswerCheck,
} from '../pairs-attribution.js';
import {
  DEFAULT_SPATIAL_RECORDS_ARM,
  loadRecordedSpatialSignal,
  type RecordedSpatialSignal,
} from '../recorded-spatial.js';
import {
  TYPESAFE_ENV,
  type TypeSafeSettings,
  typesafeSettings,
} from '../typesafe-settings.js';

/** A layout decision as some stages return it, with the composed-pairs record. */
export type LayoutOutput = LayoutDecision & {
  readonly pairwise?: ComposedPairsRecord;
};

/** What the layout stage eval records of one decision. */
export interface LayoutTurnDetail {
  readonly source: LayoutSource;
  readonly layoutId?: string;
  /** Absent when the decision handed the layout off. */
  readonly tree?: readonly TilingNode[];
  readonly answers: readonly AnswerRecord[];
  /** The composed-pairs stage only. */
  readonly pairwise?: ComposedPairsRecord;
  /** Composed-pairs calls only: every pair against the scenario's reference tree, or why it cannot be compared. */
  readonly pairCheck?: PairsAnswerCheck | { readonly unavailable: string };
  /**
   * Present on a turn that asks no arrangement: a scenario not tagged
   * spatial, expecting an output, whose visible Instances are the current
   * tree's and whose current tree fits. `changed` is whether the returned
   * tree differs from the current one.
   */
  readonly arrangementNotAsked?: { readonly changed: boolean };
}

/** What every layout stage variant runs on: the TypeSafe client of the turn. */
export interface LayoutDeps {
  readonly ask: Ask;
}

type LayoutStage = (ask: Ask) => Stage<GatedActionPlan, LayoutOutput>;

/**
 * Layout stages by descriptive variant name, each the layout stage of an
 * arm in `src/plugins/jev/arms.ts`: `preset` the preset choice with
 * placement descriptions, `preset-or-llm` the preset choice that may keep
 * the tree or hand it off, and `composed-pairs` the composed pairs
 * planner's layout stage, `layoutComposedPairsGateAndDefer`.
 */
export const LAYOUT_STAGES: Readonly<Record<string, LayoutStage>> = {
  preset: (ask) => layoutPreset(ask, { describe: 'placements' }),
  'preset-or-llm': layoutPresetOrLlm,
  'composed-pairs': layoutComposedPairsGateAndDefer,
};

/** {@link LAYOUT_STAGES} as the stage eval's variants, on the turn's `ask`. */
export const LAYOUT_VARIANTS: Readonly<
  Record<string, (deps: LayoutDeps) => Stage<GatedActionPlan, LayoutOutput>>
> = Object.fromEntries(
  Object.entries(LAYOUT_STAGES).map(([name, stage]) => [
    name,
    (deps: LayoutDeps) => stage(deps.ask),
  ]),
);

/** The deferral reason a scenario that expects the layout stage to defer expects, unless it states `deferCause: 'arrangement_not_stated'`. */
export const EXPECTED_LAYOUT_DEFERRAL = 'jevLayout/no_feasible_layout';

/**
 * The deferral reason a scenario that expects the layout stage to defer
 * with `deferCause: 'arrangement_not_stated'` expects: the spatial gate
 * said yes on a request with intent text, yet no answer stated an
 * arrangement or a size and the picked tree places the Instances as the
 * current one does.
 */
export const EXPECTED_UNSTATED_LAYOUT_DEFERRAL = 'jevLayout/spatial_not_stated';

/** Where {@link layoutModuleWith} takes the stage's client and spatial gate from. */
export interface LayoutModuleOptions {
  /** TypeSafe settings for every turn's client; the environment's when absent. */
  readonly typesafe?: TypeSafeSettings;
  /**
   * The spatial gate a live planner answered, per scenario turn; a turn it
   * holds no gate for keeps the gold gate. Every gate is gold when absent.
   */
  readonly spatialSignal?: RecordedSpatialSignal;
}

/** The module {@link layoutModuleWith} builds. */
export type LayoutModule = StageEvalModule<
  GatedActionPlan,
  LayoutOutput,
  LayoutTurnDetail,
  LayoutDeps
>;

/**
 * The layout stage on gold inputs: each scenario's expected selection and
 * action plan with every gate (see `goldInputs`), or, for a scenario that
 * expects the layout stage to defer, the board as it is (see
 * `layoutDeferralGoldInputs`). With `spatialSignal` the spatial gate of
 * each turn is the recorded live one where there is one. A decision with a
 * tree passes when the tree's leaves are the expected visible set, the
 * arrangement rules hold and the tree fits the Chart and every minimum
 * size; a decision without a tree is handed off. A scenario that expects
 * a layout deferral passes only on {@link EXPECTED_UNSTATED_LAYOUT_DEFERRAL}
 * when its `deferCause` is `arrangement_not_stated`, and otherwise only on
 * {@link EXPECTED_LAYOUT_DEFERRAL}. The preset variants never give the
 * first reason, so they never pass those scenarios.
 */
export function layoutModuleWith(
  options: LayoutModuleOptions = {},
): LayoutModule {
  const { spatialSignal } = options;
  const typesafe = options.typesafe ?? typesafeSettings();
  return {
    name: 'layout',
    stage: STAGE_NAME.jevLayout,
    provider: 'Jev',
    requiredEnv: TYPESAFE_ENV,
    variants: LAYOUT_VARIANTS,
    makeDeps: (onCall) => ({
      ask: (stage, evaluation, ctx) =>
        createTypeSafeClient({
          ...typesafe(),
          onCall: (call) => {
            const recorded = { ...call, state: evaluation.state };
            onCall(recorded);
          },
        })(stage, evaluation, ctx),
    }),
    flags: {
      'spatial-signal': { type: 'string', default: 'gold' },
      'spatial-records': { type: 'string' },
      'spatial-records-arm': { type: 'string' },
    },
    configure: async (values, run) => {
      const signal = values['spatial-signal'];
      const meta = { jevModel: typesafe().model, inputs: 'gold' };
      if (
        signal !== 'recorded-live' &&
        (values['spatial-records'] !== undefined ||
          values['spatial-records-arm'] !== undefined)
      )
        throw new Error(
          '--spatial-records and --spatial-records-arm need --spatial-signal recorded-live',
        );
      if (signal === 'gold')
        return {
          module: layoutModuleWith(options),
          meta: { ...meta, spatialSignal: 'gold' },
        };
      if (signal !== 'recorded-live')
        throw new Error('--spatial-signal must be one of gold, recorded-live');
      const path = values['spatial-records'];
      if (typeof path !== 'string')
        throw new Error(
          '--spatial-signal recorded-live needs --spatial-records <records.json of a full planner eval>',
        );
      const arm = String(
        values['spatial-records-arm'] ?? DEFAULT_SPATIAL_RECORDS_ARM,
      );
      const known = jevArms(typesafe).map((registered) => registered.name);
      if (!known.includes(arm))
        throw new Error(
          `--spatial-records-arm: unknown arm ${arm}; known arms: ${known.join(', ')}`,
        );
      const recorded = await loadRecordedSpatialSignal(path, arm);
      let found = 0;
      for (const scenario of run.scenarios)
        for (let repeat = 1; repeat <= run.repeats; repeat++)
          if (recorded.lookup(scenario.id, repeat)) found++;
      if (found === 0)
        throw new Error(
          `${path} holds no spatial gate recorded by arm ${arm} for the selected ${run.scenarios.length} scenarios x ${run.repeats} repeats; every turn would fall back to gold`,
        );
      return {
        module: layoutModuleWith({ ...options, spatialSignal: recorded }),
        meta: {
          ...meta,
          spatialSignal: `recorded live from ${path} (${arm}), gold where none was recorded`,
          spatialSignalRecordedTurns: `${found} of ${run.scenarios.length * run.repeats} scenario turns`,
        },
      };
    },
    prepare: async (scenario, ctx) => {
      const gold = expectsLayoutDeferral(scenario)
        ? layoutDeferralGoldInputs(scenario, 'gated')
        : goldInputs(scenario, 'gated');
      if (!gold.applicable) return gold;
      const { jevSelect, jevActions } = gold.stages;
      if (jevSelect === undefined || jevActions === undefined)
        return { applicable: false, reason: 'gold inputs formed no stages' };
      const selection = await jevSelect(ctx.origin, ctx);
      if (isErr(selection))
        return { applicable: false, reason: 'the gold selection failed' };
      const plan = await jevActions(selection.value, ctx);
      if (isErr(plan))
        return { applicable: false, reason: 'the gold action plan failed' };
      return {
        applicable: true,
        input: plan.value as GatedActionPlan,
        origin: ctx.origin,
      };
    },
    ...(spatialSignal && {
      turnInput: (scenario, repeat, input) => {
        const spatial = spatialSignal.lookup(scenario.id, repeat);
        return spatial === undefined ? input : withSpatialGate(input, spatial);
      },
    }),
    expectedDeferral: (scenario) =>
      expectsLayoutDeferral(scenario)
        ? scenario.expected.deferCause === 'arrangement_not_stated'
          ? EXPECTED_UNSTATED_LAYOUT_DEFERRAL
          : EXPECTED_LAYOUT_DEFERRAL
        : undefined,
    judge: judgeLayout,
    reportSections: (records, variants) =>
      [
        renderArrangementNotAskedSection(records, variants),
        renderComposedPairsSection(records, variants),
      ].flatMap((section) => section ?? []),
  };
}

/** {@link layoutModuleWith} on the environment's TypeSafe settings, with every gate gold. */
export const layoutModule: LayoutModule = layoutModuleWith();

/** Scores one layout decision on `input` against `scenario` (see {@link layoutModule}). */
export function judgeLayout(
  scenario: Scenario,
  input: GatedActionPlan,
  output: LayoutOutput,
): Judgement<LayoutTurnDetail> {
  const recorded: LayoutTurnDetail = {
    source: output.source,
    ...(output.layoutId !== undefined && { layoutId: output.layoutId }),
    ...(output.tree !== undefined && { tree: output.tree }),
    answers: output.answers,
    ...(output.pairwise && { pairwise: output.pairwise }),
  };
  const pairCheck = output.pairwise?.called
    ? comparePairs(scenario, output.pairwise, output.tree)
    : undefined;
  const failures =
    output.tree === undefined ? [] : treeFailures(scenario, input, output.tree);
  const outcome =
    output.tree === undefined
      ? 'handed_off'
      : failures.length === 0
        ? 'pass'
        : 'fail';
  const arrangementNotAsked = asksNoArrangement(scenario, input)
    ? {
        changed: output.tree !== undefined && !keepsTree(scenario, output.tree),
      }
    : undefined;
  return {
    outcome,
    failures,
    detail: {
      ...recorded,
      ...(pairCheck && { pairCheck }),
      ...(arrangementNotAsked && { arrangementNotAsked }),
    },
  };
}

function expectsLayoutDeferral(scenario: Scenario): boolean {
  return (
    scenario.expected.status === 'deferred' &&
    scenario.expected.deferStage === 'layout'
  );
}

function withSpatialGate(
  plan: GatedActionPlan,
  spatial: GateAnswer,
): GatedActionPlan {
  return {
    ...plan,
    gates: { ...plan.gates, spatial },
    selection: {
      ...plan.selection,
      ...(plan.selection.gates && {
        gates: { ...plan.selection.gates, spatial },
      }),
    },
  };
}

function asksNoArrangement(
  scenario: Scenario,
  input: GatedActionPlan,
): boolean {
  if (scenario.spatial === true || scenario.expected.status !== 'planned')
    return false;
  const { request } = input.selection.input;
  if (request.layout.type !== 'tiling') return false;
  const visible = visibleInstances(input);
  if (visible === undefined) return false;
  const current = getVisibleInstanceIds(request.layout);
  return (
    current.size === visible.length &&
    visible.every(({ instanceId }) => current.has(instanceId)) &&
    layoutFits(request, request.layout.tree, visible)
  );
}

function keepsTree(scenario: Scenario, tree: readonly TilingNode[]): boolean {
  return checkArrangement([{ kind: 'unchangedTree' }], {
    request: scenario.request,
    tree,
  }).pass;
}

function treeFailures(
  scenario: Scenario,
  input: GatedActionPlan,
  tree: readonly TilingNode[],
): readonly string[] {
  const failures = [...(scoreLayout(scenario, { tree })?.failures ?? [])];
  const visible = visibleInstances(input);
  if (visible === undefined)
    failures.push('Fit: the action plan does not simulate');
  else if (!layoutFits(input.selection.input.request, tree, visible))
    failures.push(
      'Fit: the tree does not place each visible Instance once within the Chart at its minimum size',
    );
  return failures;
}

function visibleInstances(
  plan: GatedActionPlan,
): readonly VesselInstanceSnapshot[] | undefined {
  const retained = plan.selection.instances.filter(
    (instance) => instance.decision !== 'delete',
  );
  const variants = finalVariants(
    retained,
    plan.actions,
    plan.selection.input.request.vessels,
  );
  if (isErr(variants)) return undefined;
  return retained
    .filter((instance) => instance.visible)
    .map((instance) => ({
      instanceId: instance.instanceId,
      vesselId: instance.vesselId,
      variant: variants.value.get(instance.instanceId) ?? instance.variant,
    }));
}

function comparePairs(
  scenario: Scenario,
  record: ComposedPairsRecord,
  tree: readonly TilingNode[] | undefined,
): PairsAnswerCheck | { readonly unavailable: string } {
  const referenceTree = referenceTreeOf(scenario);
  if (referenceTree === undefined)
    return { unavailable: 'the scenario states no reference tree' };
  const { layout } = scenario.request;
  const check = checkPairAnswers(
    record,
    referenceTree,
    layout.type === 'tiling' ? layout.tree : [],
    tree,
  );
  return typeof check === 'string' ? { unavailable: check } : check;
}

/** The scenario's reference tree, or the current tree when the scenario expects it unchanged. */
function referenceTreeOf(
  scenario: Scenario,
): readonly (string | null)[] | undefined {
  if (scenario.expected.tree !== undefined) return scenario.expected.tree;
  const { layout } = scenario.request;
  return scenario.expected.arrangement?.some(
    (rule) => rule.kind === 'unchangedTree',
  ) && layout.type === 'tiling'
    ? layout.tree
    : undefined;
}
