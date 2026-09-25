import { describe, expect, test } from 'bun:test';
import type { TilingNode } from '@maelstrom-co/protocol';
import { makeRequest } from './__test-helpers__/fixtures.js';
import {
  type Arranged,
  above,
  below,
  checkArrangement,
  describeRule,
  dominant,
  leftOf,
  order,
  rightOf,
  sideBySide,
  spansFullHeight,
  spansFullWidth,
  stacked,
  unchangedTree,
  weightRatio,
} from './predicates.js';

const request = makeRequest('arrange', { columns: 12, rows: 6 });

function board(tree: readonly (string | null)[]): Arranged {
  return { request, tree: tree as readonly TilingNode[] };
}

// calendar | (weather over tasks), calendar two thirds wide.
const focus = board([
  'V:2,1',
  'ID:calendar-main',
  'H',
  'ID:weather-main',
  'ID:tasks-main',
]);
// map full width on top of (calendar | weather | tasks), map one third high.
const banner = board([
  'H:1,2',
  'ID:map-main',
  'V:1,1,1',
  'ID:calendar-main',
  'ID:weather-main',
  'ID:tasks-main',
]);

describe('leftOf / rightOf', () => {
  test('pass when a ends before b starts and they share rows', () => {
    expect(leftOf('calendar-main', 'weather-main')(focus).pass).toBe(true);
    expect(rightOf('tasks-main', 'calendar-main')(focus).pass).toBe(true);
  });
  test('fail on the wrong side, with a readable detail', () => {
    const check = leftOf('weather-main', 'calendar-main')(focus);
    expect(check.pass).toBe(false);
    expect(check.detail).toContain('weather-main');
    expect(check.detail).toContain('calendar-main');
  });
  test('fail when the two share no rows', () => {
    const diagonal = board([
      'H',
      'V',
      'ID:calendar-main',
      null,
      'V',
      null,
      'ID:weather-main',
    ]);
    const check = leftOf('calendar-main', 'weather-main')(diagonal);
    expect(check.pass).toBe(false);
    expect(check.detail).toContain('share no rows');
  });
});

describe('above / below', () => {
  test('use the vertical axis and require shared columns', () => {
    expect(above('weather-main', 'tasks-main')(focus).pass).toBe(true);
    expect(below('tasks-main', 'weather-main')(focus).pass).toBe(true);
    expect(above('map-main', 'tasks-main')(banner).pass).toBe(true);
    expect(above('calendar-main', 'tasks-main')(focus).pass).toBe(false);
  });
});

describe('order', () => {
  test('checks consecutive ids along an axis', () => {
    expect(
      order(['calendar-main', 'weather-main', 'tasks-main'], 'x')(banner).pass,
    ).toBe(true);
    expect(
      order(['weather-main', 'calendar-main', 'tasks-main'], 'x')(banner).pass,
    ).toBe(false);
    expect(order(['map-main', 'weather-main'], 'y')(banner).pass).toBe(true);
  });
});

describe('dominant', () => {
  test('needs the largest region and at least the share', () => {
    expect(dominant('calendar-main', 0.6)(focus).pass).toBe(true);
    expect(dominant('calendar-main', 0.7)(focus).pass).toBe(false);
    expect(dominant('weather-main', 0.1)(focus).pass).toBe(false);
  });
});

describe('spansFullWidth / spansFullHeight', () => {
  test('compare against the Chart, not the parent split', () => {
    expect(spansFullWidth('map-main')(banner).pass).toBe(true);
    expect(spansFullWidth('calendar-main')(banner).pass).toBe(false);
    expect(spansFullHeight('calendar-main')(focus).pass).toBe(true);
    expect(spansFullHeight('weather-main')(focus).pass).toBe(false);
  });
});

describe('sideBySide / stacked', () => {
  test('sideBySide needs one row in any order', () => {
    expect(
      sideBySide(['tasks-main', 'calendar-main', 'weather-main'])(banner).pass,
    ).toBe(true);
    expect(sideBySide(['map-main', 'calendar-main'])(banner).pass).toBe(false);
  });
  test('stacked needs one column in any order', () => {
    expect(stacked(['tasks-main', 'weather-main'])(focus).pass).toBe(true);
    expect(stacked(['calendar-main', 'weather-main'])(focus).pass).toBe(false);
  });
});

describe('unchangedTree', () => {
  const current = makeRequest('keep', { columns: 12, rows: 6 });
  const tree = current.layout.type === 'tiling' ? [...current.layout.tree] : [];
  test('passes the request’s own tree, with equivalent weights', () => {
    expect(unchangedTree()({ request: current, tree }).pass).toBe(true);
    const [root, ...rest] = tree;
    const spelled = parseWeights(root);
    if (spelled)
      expect(
        unchangedTree()({
          request: current,
          tree: [
            `${spelled.axis}:${spelled.weights.map((w) => w * 2).join(',')}`,
            ...rest,
          ] as TilingNode[],
        }).pass,
      ).toBe(true);
  });
  test('fails a reordered tree', () => {
    const [root, first, second, ...rest] = tree;
    const check = unchangedTree()({
      request: current,
      tree: [root, second, first, ...rest] as TilingNode[],
    });
    expect(check.pass).toBe(false);
  });
});

describe('weightRatio', () => {
  test('compares areas within inclusive bounds', () => {
    expect(
      weightRatio('calendar-main', 'weather-main', 3.9, 4.1)(focus).pass,
    ).toBe(true);
    expect(weightRatio('calendar-main', 'weather-main', 0, 2)(focus).pass).toBe(
      false,
    );
  });
});

describe('invalid layouts', () => {
  test('a missing instance or a malformed tree fails every rule', () => {
    expect(leftOf('map-main', 'calendar-main')(focus).detail).toContain(
      'map-main is not in the tree',
    );
    expect(
      dominant('calendar-main', 0.1)(board(['V', 'ID:a'])).detail,
    ).toContain('not a valid tiling');
  });
});

describe('checkArrangement', () => {
  test('lists each failed rule with its description', () => {
    const score = checkArrangement(
      [
        { kind: 'leftOf', a: 'calendar-main', b: 'weather-main' },
        { kind: 'spansFullWidth', id: 'calendar-main' },
        { kind: 'order', ids: ['tasks-main', 'weather-main'], axis: 'y' },
      ],
      focus,
    );
    expect(score.pass).toBe(false);
    expect(score.failures).toHaveLength(2);
    expect(score.failures[0]).toStartWith('spansFullWidth(calendar-main): ');
    expect(score.failures[1]).toStartWith(
      'order(tasks-main, weather-main by y): ',
    );
  });
  test('describes every rule kind compactly', () => {
    expect(describeRule({ kind: 'unchangedTree' })).toBe('unchangedTree()');
    expect(
      describeRule({
        kind: 'weightRatio',
        a: 'map-main',
        b: 'calendar-main',
        min: 1,
        max: 2,
      }),
    ).toBe('weightRatio(map-main, calendar-main, 1..2)');
  });
});

function parseWeights(token: unknown) {
  if (typeof token !== 'string') return undefined;
  const [axis, weights] = token.split(':');
  if (weights === undefined) return undefined;
  return { axis, weights: weights.split(',').map(Number) };
}
