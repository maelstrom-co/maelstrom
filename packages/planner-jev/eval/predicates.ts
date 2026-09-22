import {
  type ChartRequest,
  parseTilingSplitToken,
  type TilingNode,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';

import { type LeafRect, treeRects } from '../src/lib/layout-fit.js';

/** `x` runs left to right, `y` top to bottom. */
export type Axis = 'x' | 'y';

export interface Check {
  readonly pass: boolean;
  readonly detail: string;
}

/** A tiling tree on the Chart of the request it answers. */
export interface Arranged {
  readonly request: ChartRequest;
  readonly tree: readonly TilingNode[];
}

export type Predicate = (layout: Arranged) => Check;

/** An arrangement expectation as data, evaluated by {@link checkRule}. */
export type ArrangementRule =
  | {
      readonly kind: 'order';
      readonly ids: readonly string[];
      readonly axis: Axis;
    }
  | {
      readonly kind: 'leftOf' | 'rightOf' | 'above' | 'below';
      readonly a: string;
      readonly b: string;
    }
  | {
      readonly kind: 'dominant';
      readonly id: string;
      readonly minShare: number;
    }
  | { readonly kind: 'spansFullWidth' | 'spansFullHeight'; readonly id: string }
  | { readonly kind: 'sideBySide' | 'stacked'; readonly ids: readonly string[] }
  | { readonly kind: 'unchangedTree' }
  | {
      readonly kind: 'weightRatio';
      readonly a: string;
      readonly b: string;
      readonly min: number;
      readonly max: number;
    };

const EPSILON = 1e-6;

/** `a` ends before `b` starts along `x`, and the two share some rows. */
export function leftOf(a: string, b: string): Predicate {
  return before(a, b, 'x');
}

export function rightOf(a: string, b: string): Predicate {
  return before(b, a, 'x');
}

/** `a` ends before `b` starts along `y`, and the two share some columns. */
export function above(a: string, b: string): Predicate {
  return before(a, b, 'y');
}

export function below(a: string, b: string): Predicate {
  return before(b, a, 'y');
}

/** Each id ends before the next one starts along `axis`. */
export function order(ids: readonly string[], axis: Axis): Predicate {
  return (layout) =>
    withRects(layout, ids, (rects) => {
      for (let index = 1; index < rects.length; index++) {
        const previous = rects[index - 1];
        const next = rects[index];
        if (end(previous, axis) > start(next, axis) + EPSILON)
          return fail(
            `${previous.instanceId} ends at ${axis}=${round(end(previous, axis))}, after ${next.instanceId} starts at ${round(start(next, axis))}`,
          );
      }
      return pass(`${ids.join(', ')} in ${axis} order`);
    });
}

/** `id` has the largest region and at least `minShare` of the Chart. */
export function dominant(id: string, minShare: number): Predicate {
  return (layout) =>
    withRects(layout, [id], ([rect], all) => {
      const share = area(rect) / chartArea(layout);
      const larger = all.find(
        (other) =>
          other.instanceId !== rect.instanceId &&
          area(other) > area(rect) + EPSILON,
      );
      if (larger)
        return fail(
          `${larger.instanceId} is larger than ${id} (${percent(area(larger) / chartArea(layout))} vs ${percent(share)})`,
        );
      if (share + EPSILON < minShare)
        return fail(
          `${id} has ${percent(share)} of the Chart, below ${percent(minShare)}`,
        );
      return pass(`${id} has ${percent(share)} of the Chart`);
    });
}

export function spansFullWidth(id: string): Predicate {
  return spans(id, 'x');
}

export function spansFullHeight(id: string): Predicate {
  return spans(id, 'y');
}

/** One row: in `x` order the regions do not overlap, and every pair shares rows. */
export function sideBySide(ids: readonly string[]): Predicate {
  return line(ids, 'x');
}

/** One column: in `y` order the regions do not overlap, and every pair shares columns. */
export function stacked(ids: readonly string[]): Predicate {
  return line(ids, 'y');
}

/** The tree equals the request's current tree, split weights compared as fractions. */
export function unchangedTree(): Predicate {
  return (layout) => {
    const previous =
      layout.request.layout.type === 'tiling' ? layout.request.layout.tree : [];
    const wanted = normalize(previous);
    const actual = normalize(layout.tree);
    return JSON.stringify(wanted) === JSON.stringify(actual)
      ? pass('tree unchanged')
      : fail(
          `expected ${JSON.stringify(previous)}, received ${JSON.stringify(layout.tree)}`,
        );
  };
}

/** The area of `a` over the area of `b` lies within `[min, max]`. */
export function weightRatio(
  a: string,
  b: string,
  min: number,
  max: number,
): Predicate {
  return (layout) =>
    withRects(layout, [a, b], ([first, second]) => {
      const ratio = area(first) / area(second);
      const detail = `${a}/${b} area ratio ${round(ratio)}`;
      return ratio + EPSILON >= min && ratio - EPSILON <= max
        ? pass(detail)
        : fail(`${detail}, outside ${min}..${max}`);
    });
}

export function checkRule(rule: ArrangementRule): Predicate {
  switch (rule.kind) {
    case 'order':
      return order(rule.ids, rule.axis);
    case 'leftOf':
      return leftOf(rule.a, rule.b);
    case 'rightOf':
      return rightOf(rule.a, rule.b);
    case 'above':
      return above(rule.a, rule.b);
    case 'below':
      return below(rule.a, rule.b);
    case 'dominant':
      return dominant(rule.id, rule.minShare);
    case 'spansFullWidth':
      return spansFullWidth(rule.id);
    case 'spansFullHeight':
      return spansFullHeight(rule.id);
    case 'sideBySide':
      return sideBySide(rule.ids);
    case 'stacked':
      return stacked(rule.ids);
    case 'unchangedTree':
      return unchangedTree();
    case 'weightRatio':
      return weightRatio(rule.a, rule.b, rule.min, rule.max);
  }
}

/** A compact label for failure strings, for example `leftOf(a, b)`. */
export function describeRule(rule: ArrangementRule): string {
  switch (rule.kind) {
    case 'order':
      return `order(${rule.ids.join(', ')} by ${rule.axis})`;
    case 'leftOf':
    case 'rightOf':
    case 'above':
    case 'below':
      return `${rule.kind}(${rule.a}, ${rule.b})`;
    case 'dominant':
      return `dominant(${rule.id}, ${rule.minShare})`;
    case 'spansFullWidth':
    case 'spansFullHeight':
      return `${rule.kind}(${rule.id})`;
    case 'sideBySide':
    case 'stacked':
      return `${rule.kind}(${rule.ids.join(', ')})`;
    case 'unchangedTree':
      return 'unchangedTree()';
    case 'weightRatio':
      return `weightRatio(${rule.a}, ${rule.b}, ${rule.min}..${rule.max})`;
  }
}

/** Every rule against `layout`; each failure reads `<rule>: <detail>`. */
export function checkArrangement(
  rules: readonly ArrangementRule[],
  layout: Arranged,
): { readonly pass: boolean; readonly failures: readonly string[] } {
  const failures = rules.flatMap((rule) => {
    const check = checkRule(rule)(layout);
    return check.pass ? [] : [`${describeRule(rule)}: ${check.detail}`];
  });
  return { pass: failures.length === 0, failures };
}

function before(a: string, b: string, axis: Axis): Predicate {
  const cross: Axis = axis === 'x' ? 'y' : 'x';
  const shared = axis === 'x' ? 'rows' : 'columns';
  return (layout) =>
    withRects(layout, [a, b], ([first, second]) => {
      if (overlap(first, second, cross) <= EPSILON)
        return fail(`${a} and ${b} share no ${shared}`);
      if (end(first, axis) > start(second, axis) + EPSILON)
        return fail(
          `${a} spans ${axis}=${round(start(first, axis))}..${round(end(first, axis))}, ${b} starts at ${round(start(second, axis))}`,
        );
      return pass(
        `${a} ends at ${axis}=${round(end(first, axis))}, ${b} starts at ${round(start(second, axis))}`,
      );
    });
}

function spans(id: string, axis: Axis): Predicate {
  return (layout) =>
    withRects(layout, [id], ([rect]) => {
      const { columns, rows } = layout.request.context.chartDimensions;
      const full = axis === 'x' ? columns : rows;
      const detail = `${id} spans ${axis}=${round(start(rect, axis))}..${round(end(rect, axis))} of 0..${full}`;
      return Math.abs(start(rect, axis)) <= EPSILON &&
        Math.abs(end(rect, axis) - full) <= EPSILON
        ? pass(detail)
        : fail(detail);
    });
}

function line(ids: readonly string[], axis: Axis): Predicate {
  const cross: Axis = axis === 'x' ? 'y' : 'x';
  const shared = axis === 'x' ? 'rows' : 'columns';
  return (layout) =>
    withRects(layout, ids, (rects) => {
      const sorted = [...rects].sort((p, q) => start(p, axis) - start(q, axis));
      for (let index = 1; index < sorted.length; index++)
        if (end(sorted[index - 1], axis) > start(sorted[index], axis) + EPSILON)
          return fail(
            `${sorted[index - 1].instanceId} and ${sorted[index].instanceId} overlap along ${axis}`,
          );
      for (const first of rects)
        for (const second of rects)
          if (first !== second && overlap(first, second, cross) <= EPSILON)
            return fail(
              `${first.instanceId} and ${second.instanceId} share no ${shared}`,
            );
      return pass(`${ids.join(', ')} in one line along ${axis}`);
    });
}

function withRects(
  layout: Arranged,
  ids: readonly string[],
  check: (rects: LeafRect[], all: readonly LeafRect[]) => Check,
): Check {
  const all = treeRects(layout.request, layout.tree);
  if (all === undefined) return fail('the tree is not a valid tiling');
  const rects: LeafRect[] = [];
  for (const id of ids) {
    const rect = all.find((candidate) => candidate.instanceId === id);
    if (rect === undefined) return fail(`${id} is not in the tree`);
    rects.push(rect);
  }
  return check(rects, all);
}

function normalize(tree: readonly TilingNode[]): readonly unknown[] {
  return tree.map((token) => {
    const split = parseTilingSplitToken(token);
    if (split) {
      const total = split.weights.reduce((sum, weight) => sum + weight, 0);
      return `${split.axis}:${split.weights.map((weight) => round(weight / total, 6)).join(',')}`;
    }
    return token === null ? null : (tilingLeafInstanceId(token) ?? token);
  });
}

function start(rect: LeafRect, axis: Axis): number {
  return axis === 'x' ? rect.x : rect.y;
}

function end(rect: LeafRect, axis: Axis): number {
  return axis === 'x' ? rect.x + rect.width : rect.y + rect.height;
}

function overlap(a: LeafRect, b: LeafRect, axis: Axis): number {
  return (
    Math.min(end(a, axis), end(b, axis)) -
    Math.max(start(a, axis), start(b, axis))
  );
}

function area(rect: LeafRect): number {
  return rect.width * rect.height;
}

function chartArea(layout: Arranged): number {
  const { columns, rows } = layout.request.context.chartDimensions;
  return columns * rows;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function pass(detail: string): Check {
  return { pass: true, detail };
}

function fail(detail: string): Check {
  return { pass: false, detail };
}
