import type {
  ComposedRoute,
  PairsHandOff,
  PairsSizeFallback,
} from '@maelstrom-co/planner-jev/_eval';
import type { StageTurnRecord } from '../../core/stage-eval.js';
import {
  percentile,
  type Ratio,
  ratio,
  STAGE_RATIO,
} from '../../core/stats.js';
import type { LayoutTurnDetail } from './stages/layout.js';

/** The composed-pairs layout stage's numbers for one variant. */
export interface ComposedPairsVariantSummary {
  readonly variant: string;
  /** Turns per gating route, and how many of them called Jev. */
  readonly routes: Readonly<
    Record<ComposedRoute, { readonly turns: number; readonly calls: number }>
  >;
  readonly handOffs: Readonly<Record<PairsHandOff, number>>;
  /** How often the first, second or third candidate was the returned tree. */
  readonly chosenRank: readonly number[];
  /** Turns whose returned tree a size fallback wrote, by fallback. */
  readonly sizeFallbacks: Readonly<Record<PairsSizeFallback, number>>;
  /** Called turns whose pairs could be compared with the reference tree. */
  readonly compared: number;
  /** Wrong pair answers, not stated read as the current tree's relation, over compared pairs. */
  readonly wrongAnswers: Ratio;
  readonly notStated: Ratio;
  /** Pairs the returned tree relates otherwise than the reference, over pairs of compared turns that returned a tree. */
  readonly wrongInTree: Ratio;
  readonly referenceInCandidates: Ratio;
  /** Median over called turns of the best tree's score minus the second best's. */
  readonly medianMargin: number | undefined;
  /** Wrong top-level direction answers, not stated read as the current top split, over compared calls that asked it. */
  readonly wrongDirection: Ratio;
  readonly directionNotStated: Ratio;
  /** Turns whose failures include a `weightRatio` or `dominant` rule. */
  readonly sizeRuleFailures: number;
  /** Confidence percentiles over every whole-Chart size and size comparison answer; absent when none was recorded. */
  readonly sizeConfidence?: {
    readonly p10: number;
    readonly p50: number;
    readonly p90: number;
  };
}

/** Summarises `variant`'s composed-pairs records; `undefined` when none recorded one. */
export function summarizeComposedPairs(
  records: readonly StageTurnRecord<LayoutTurnDetail>[],
  variant: string,
): ComposedPairsVariantSummary | undefined {
  const ownRecords = records.filter(
    (record) => record.variant === variant && record.detail?.pairwise,
  );
  const own = ownRecords.flatMap((record) =>
    record.detail ? [record.detail] : [],
  );
  if (own.length === 0) return undefined;
  const sizeRuleFailures = ownRecords.filter((record) =>
    record.failures.some((failure) => SIZE_RULE.test(failure)),
  ).length;
  const confidences = own.flatMap(({ pairwise }) =>
    Object.values(pairwise?.sizes ?? {}).map((size) => size.confidence),
  );
  const p10 = percentile(confidences, 10);
  const p50 = percentile(confidences, 50);
  const p90 = percentile(confidences, 90);
  const sizeConfidence =
    p10 === undefined || p50 === undefined || p90 === undefined
      ? undefined
      : { p10, p50, p90 };
  const routes = {
    spatial: { turns: 0, calls: 0 },
    same_instances: { turns: 0, calls: 0 },
    instances_changed: { turns: 0, calls: 0 },
  };
  const handOffs = { too_many_instances: 0 };
  const chosenRank = [0, 0, 0];
  const sizeFallbacks = { raised_to_minimum: 0, equal_weights: 0 };
  let compared = 0;
  const wrongAnswers = { count: 0, total: 0 };
  const notStated = { count: 0, total: 0 };
  const wrongInTree = { count: 0, total: 0 };
  const referenceInCandidates = { count: 0, total: 0 };
  const margins: number[] = [];
  const wrongDirection = { count: 0, total: 0 };
  const directionNotStated = { count: 0, total: 0 };
  for (const detail of own) {
    const record = detail.pairwise;
    if (record === undefined) continue;
    routes[record.route].turns += 1;
    if (record.called) routes[record.route].calls += 1;
    if (record.handOff) handOffs[record.handOff] += 1;
    if (record.chosen !== undefined && record.chosen < 3)
      chosenRank[record.chosen] += 1;
    if (record.fallback) sizeFallbacks[record.fallback.kind] += 1;
    if (record.margin !== undefined) margins.push(record.margin);
    const check = detail.pairCheck;
    if (check === undefined || 'unavailable' in check) continue;
    compared += 1;
    wrongAnswers.total += check.compared;
    wrongAnswers.count += check.wrongAnswers.length;
    notStated.total += check.compared;
    notStated.count += check.notStated;
    if (check.wrongInTree) {
      wrongInTree.total += check.compared;
      wrongInTree.count += check.wrongInTree.length;
    }
    referenceInCandidates.total += 1;
    if (check.referenceInCandidates) referenceInCandidates.count += 1;
    if (check.direction) {
      wrongDirection.total += 1;
      if (check.direction.wrong) wrongDirection.count += 1;
      directionNotStated.total += 1;
      if (check.direction.notStated) directionNotStated.count += 1;
    }
  }
  return {
    variant,
    routes,
    handOffs,
    chosenRank,
    sizeFallbacks,
    compared,
    wrongAnswers,
    notStated,
    wrongInTree,
    referenceInCandidates,
    medianMargin: percentile(margins, 50),
    wrongDirection,
    directionNotStated,
    sizeRuleFailures,
    ...(sizeConfidence && { sizeConfidence }),
  };
}

const SIZE_RULE = /\b(weightRatio|dominant)\(/;

/**
 * The composed-pairs section: gating routes, hand-off causes, the chosen
 * candidate's rank, pair relations against the scenario's reference tree,
 * how often the reference was among the top candidates, and the median
 * score margin. `undefined` when no variant recorded a composed-pairs turn.
 */
export function renderComposedPairsSection(
  records: readonly StageTurnRecord<LayoutTurnDetail>[],
  variants: readonly string[],
): string | undefined {
  const summaries = variants.flatMap(
    (variant) => summarizeComposedPairs(records, variant) ?? [],
  );
  if (summaries.length === 0) return undefined;
  const rows: string[] = [
    `| Metric | ${summaries.map((s) => s.variant).join(' | ')} |`,
    `| --- |${summaries.map(() => ' --- |').join('')}`,
  ];
  const row = (
    label: string,
    cell: (summary: ComposedPairsVariantSummary) => string,
  ) => rows.push(`| ${label} | ${summaries.map(cell).join(' | ')} |`);
  for (const route of [
    'spatial',
    'same_instances',
    'instances_changed',
  ] as const)
    row(
      `Route ${route}: turns (Jev calls)`,
      (s) => `${s.routes[route].turns} (${s.routes[route].calls})`,
    );
  row('Hand-off: too_many_instances', (s) =>
    String(s.handOffs.too_many_instances),
  );
  row('Chosen candidate rank 1 / 2 / 3', (s) => s.chosenRank.join(' / '));
  row(
    'Size fallback: raised to minimum / equal weights',
    (s) =>
      `${s.sizeFallbacks.raised_to_minimum} / ${s.sizeFallbacks.equal_weights}`,
  );
  row('Calls compared with the reference tree', (s) => String(s.compared));
  row('Wrong pair answers (not stated read as the current relation)', (s) =>
    ratio(s.wrongAnswers, STAGE_RATIO),
  );
  row('Pair answers not stated', (s) => ratio(s.notStated, STAGE_RATIO));
  row('Wrong pair relations in the returned tree', (s) =>
    ratio(s.wrongInTree, STAGE_RATIO),
  );
  row('Reference tree among the top 3 candidates', (s) =>
    ratio(s.referenceInCandidates, STAGE_RATIO),
  );
  row('Median score margin, best over second best (log)', (s) =>
    s.medianMargin === undefined ? 'n/a' : s.medianMargin.toFixed(2),
  );
  const asked = (r: Ratio) => (r.total === 0 ? 'n/a' : ratio(r, STAGE_RATIO));
  row(
    'Wrong direction answers (not stated read as the current top split)',
    (s) => asked(s.wrongDirection),
  );
  row('Direction answers not stated', (s) => asked(s.directionNotStated));
  row('Turns failing a size rule (weightRatio or dominant)', (s) =>
    String(s.sizeRuleFailures),
  );
  row('Size answer confidence p10 / p50 / p90', (s) =>
    s.sizeConfidence
      ? [s.sizeConfidence.p10, s.sizeConfidence.p50, s.sizeConfidence.p90]
          .map((value) => value.toFixed(2))
          .join(' / ')
      : 'n/a',
  );
  return [
    '## Composed pairs layout',
    "Pairs are compared with the scenario's reference tree (the stated one, or the current tree when the scenario expects it unchanged), over the answered pairs it relates. A not stated answer counts as the relation the pair has in the current tree, and as wrong for a pair the current tree does not hold. The direction answer, where asked, is compared with the reference tree's top split in the same way. The reference tree is one tree the rules accept, so a wrong relation on a passing turn can be a valid alternative.",
    rows.join('\n'),
  ].join('\n\n');
}

/**
 * The turns that ask no arrangement (see
 * `LayoutTurnDetail.arrangementNotAsked`): how many ran per variant, how
 * many changed the layout, and what they cost in Jev calls and tokens.
 * `undefined` when no turn asks no arrangement.
 */
export function renderArrangementNotAskedSection(
  records: readonly StageTurnRecord<LayoutTurnDetail>[],
  variants: readonly string[],
): string | undefined {
  const turns = records.filter((record) => record.detail?.arrangementNotAsked);
  if (turns.length === 0) return undefined;
  const rows: string[] = [
    `| Metric | ${variants.join(' | ')} |`,
    `| --- |${variants.map(() => ' --- |').join('')}`,
  ];
  const row = (
    label: string,
    cell: (own: readonly StageTurnRecord<LayoutTurnDetail>[]) => string,
  ) =>
    rows.push(
      `| ${label} | ${variants
        .map((variant) =>
          cell(turns.filter((record) => record.variant === variant)),
        )
        .join(' | ')} |`,
    );
  const perTurn = (
    own: readonly StageTurnRecord<LayoutTurnDetail>[],
    value: (record: StageTurnRecord<LayoutTurnDetail>) => number,
    digits: number,
  ) =>
    own.length === 0
      ? 'n/a'
      : (
          own.reduce((total, record) => total + value(record), 0) / own.length
        ).toFixed(digits);
  const tokens =
    (side: 'inputTokens' | 'outputTokens') =>
    (record: StageTurnRecord<LayoutTurnDetail>) =>
      record.calls.reduce(
        (total, call) => total + (call.usage?.[side] ?? 0),
        0,
      );
  row(
    'Turns that ask no arrangement (same Instances, current tree fits)',
    (own) => String(own.length),
  );
  row('Changed the layout', (own) =>
    ratio(
      {
        count: own.filter(
          (record) => record.detail?.arrangementNotAsked?.changed,
        ).length,
        total: own.length,
      },
      STAGE_RATIO,
    ),
  );
  row('Jev calls per turn', (own) =>
    perTurn(own, (record) => record.calls.length, 2),
  );
  row(
    'Jev tokens per turn (input / output)',
    (own) =>
      `${perTurn(own, tokens('inputTokens'), 0)} / ${perTurn(own, tokens('outputTokens'), 0)}`,
  );
  return [
    '## Turns that ask no arrangement',
    'Turns of scenarios not tagged spatial that expect an output, keep the current visible Instances and whose current tree fits. A changed layout is a returned tree that differs from the current one; a hand-off or deferral changes nothing here and is scored above.',
    rows.join('\n'),
  ].join('\n\n');
}
