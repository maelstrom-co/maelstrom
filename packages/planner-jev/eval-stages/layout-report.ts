import { percentile } from '../eval/report.js';
import type {
  ComposedHandOff,
  ComposedRoute,
} from '../src/lib/stages-experimental/layout-composed.js';
import type { PairsHandOff } from '../src/lib/stages-experimental/layout-composed-pairs.js';
import { COMPOSED_QUESTIONS } from './composed-attribution.js';
import type { LayoutTurnDetail } from './layout.js';
import { type Ratio, ratio } from './report.js';
import type { StageTurnRecord } from './stage-eval.js';

/** The composed layout stage's numbers for one variant. */
export interface ComposedVariantSummary {
  readonly variant: string;
  /** Turns per gating route, and how many of them called Jev. */
  readonly routes: Readonly<
    Record<ComposedRoute, { readonly turns: number; readonly calls: number }>
  >;
  readonly handOffs: Readonly<Record<ComposedHandOff, number>>;
  /** How often the first, second or third candidate was the returned tree. */
  readonly chosenRank: readonly number[];
  /** Missed turns (fail or handed off) by the first wrong question, `no_call`, or not comparable. */
  readonly misses: Readonly<Record<string, number>>;
  /** Called turns whose answers could be compared with the reference tree. */
  readonly compared: number;
  readonly wrongShape: Ratio;
  /** Wrong placements over every answered Instance of the compared calls. */
  readonly wrongPlacements: Ratio;
  readonly wrongPositions: Ratio;
}

/** Summarises `variant`'s composed-layout records; `undefined` when none recorded a composition. */
export function summarizeComposed(
  records: readonly StageTurnRecord<LayoutTurnDetail>[],
  variant: string,
): ComposedVariantSummary | undefined {
  const own = records.filter(
    (record) => record.variant === variant && record.detail?.composition,
  );
  if (own.length === 0) return undefined;
  const routes = {
    spatial: { turns: 0, calls: 0 },
    same_instances: { turns: 0, calls: 0 },
    instances_changed: { turns: 0, calls: 0 },
  };
  const handOffs = { nothing_fits: 0, none_of_these: 0 };
  const chosenRank = [0, 0, 0];
  const misses: Record<string, number> = Object.fromEntries(
    [...COMPOSED_QUESTIONS, 'no_call', 'not comparable'].map((key) => [key, 0]),
  );
  let compared = 0;
  const wrongShape = { count: 0, total: 0 };
  const wrongPlacements = { count: 0, total: 0 };
  const wrongPositions = { count: 0, total: 0 };
  for (const record of own) {
    const detail = record.detail as LayoutTurnDetail;
    const composition = detail.composition;
    if (composition === undefined) continue;
    routes[composition.route].turns += 1;
    if (composition.called) routes[composition.route].calls += 1;
    if (composition.handOff) handOffs[composition.handOff] += 1;
    if (composition.chosen !== undefined && composition.chosen < 3)
      chosenRank[composition.chosen] += 1;
    if (detail.miss) misses[detail.miss.question ?? 'not comparable'] += 1;
    const check = detail.answerCheck;
    if (check && !('unavailable' in check)) {
      compared += 1;
      const answered = Object.keys(check.expected.placements).length;
      wrongShape.total += 1;
      if (check.wrong.shape) wrongShape.count += 1;
      wrongPlacements.total += answered;
      wrongPlacements.count += check.wrong.placements.length;
      wrongPositions.total += answered;
      wrongPositions.count += check.wrong.positions.length;
    }
  }
  return {
    variant,
    routes,
    handOffs,
    chosenRank,
    misses,
    compared,
    wrongShape,
    wrongPlacements,
    wrongPositions,
  };
}

/**
 * The composed-layout section: gating routes, hand-off causes, the chosen
 * candidate's rank, missed turns by the first question answered wrong
 * against the scenario's reference tree, and wrong-answer rates per
 * question. `undefined` when no variant recorded a composition.
 */
export function renderComposedSection(
  records: readonly StageTurnRecord<LayoutTurnDetail>[],
  variants: readonly string[],
): string | undefined {
  const summaries = variants.flatMap(
    (variant) => summarizeComposed(records, variant) ?? [],
  );
  if (summaries.length === 0) return undefined;
  const rows: string[] = [
    `| Metric | ${summaries.map((s) => s.variant).join(' | ')} |`,
    `| --- |${summaries.map(() => ' --- |').join('')}`,
  ];
  const row = (
    label: string,
    cell: (summary: ComposedVariantSummary) => string,
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
  row('Hand-off: nothing_fits', (s) => String(s.handOffs.nothing_fits));
  row('Hand-off: none_of_these', (s) => String(s.handOffs.none_of_these));
  row('Chosen candidate rank 1 / 2 / 3', (s) => s.chosenRank.join(' / '));
  for (const key of Object.keys(summaries[0].misses))
    row(`Missed turns: ${key}`, (s) => String(s.misses[key] ?? 0));
  row('Calls compared with the reference tree', (s) => String(s.compared));
  row('Wrong shape', (s) => ratio(s.wrongShape));
  row('Wrong placements (per Instance)', (s) => ratio(s.wrongPlacements));
  row('Wrong positions (per Instance)', (s) => ratio(s.wrongPositions));
  return [
    '## Composed layout',
    "A missed turn failed or was handed off. It is attributed to the first question kind answered differently from the scenario's reference tree, in the order shape, placement, position, and to size when those all match. `no_call` turns kept or wrote a tree without asking Jev; `not comparable` turns have no reference tree (the stated one, or the current tree when the scenario expects it unchanged), or one that is not a composed shape. The reference tree is one tree the rules accept, so a wrong answer on a passing turn can be a valid alternative.",
    rows.join('\n'),
  ].join('\n\n');
}

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
}

/** Summarises `variant`'s composed-pairs records; `undefined` when none recorded one. */
export function summarizeComposedPairs(
  records: readonly StageTurnRecord<LayoutTurnDetail>[],
  variant: string,
): ComposedPairsVariantSummary | undefined {
  const own = records.flatMap((record) =>
    record.variant === variant && record.detail?.pairwise
      ? [record.detail]
      : [],
  );
  if (own.length === 0) return undefined;
  const routes = {
    spatial: { turns: 0, calls: 0 },
    same_instances: { turns: 0, calls: 0 },
    instances_changed: { turns: 0, calls: 0 },
  };
  const handOffs = { nothing_fits: 0, too_many_instances: 0 };
  const chosenRank = [0, 0, 0];
  let compared = 0;
  const wrongAnswers = { count: 0, total: 0 };
  const notStated = { count: 0, total: 0 };
  const wrongInTree = { count: 0, total: 0 };
  const referenceInCandidates = { count: 0, total: 0 };
  const margins: number[] = [];
  for (const detail of own) {
    const record = detail.pairwise;
    if (record === undefined) continue;
    routes[record.route].turns += 1;
    if (record.called) routes[record.route].calls += 1;
    if (record.handOff) handOffs[record.handOff] += 1;
    if (record.chosen !== undefined && record.chosen < 3)
      chosenRank[record.chosen] += 1;
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
  }
  return {
    variant,
    routes,
    handOffs,
    chosenRank,
    compared,
    wrongAnswers,
    notStated,
    wrongInTree,
    referenceInCandidates,
    medianMargin: percentile(margins, 50),
  };
}

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
  row('Hand-off: nothing_fits', (s) => String(s.handOffs.nothing_fits));
  row('Hand-off: too_many_instances', (s) =>
    String(s.handOffs.too_many_instances),
  );
  row('Chosen candidate rank 1 / 2 / 3', (s) => s.chosenRank.join(' / '));
  row('Calls compared with the reference tree', (s) => String(s.compared));
  row('Wrong pair answers (not stated read as the current relation)', (s) =>
    ratio(s.wrongAnswers),
  );
  row('Pair answers not stated', (s) => ratio(s.notStated));
  row('Wrong pair relations in the returned tree', (s) => ratio(s.wrongInTree));
  row('Reference tree among the top 3 candidates', (s) =>
    ratio(s.referenceInCandidates),
  );
  row('Median score margin, best over second best (log)', (s) =>
    s.medianMargin === undefined ? 'n/a' : s.medianMargin.toFixed(2),
  );
  return [
    '## Composed pairs layout',
    "Pairs are compared with the scenario's reference tree (the stated one, or the current tree when the scenario expects it unchanged), over the answered pairs it relates. A not stated answer counts as the relation the pair has in the current tree, and as wrong for a pair the current tree does not hold. The reference tree is one tree the rules accept, so a wrong relation on a passing turn can be a valid alternative.",
    rows.join('\n'),
  ].join('\n\n');
}
