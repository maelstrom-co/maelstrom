import { describe, expect, test } from 'bun:test';

import { InstanceId, type TilingNode } from '@maelstrom-co/protocol';

import type { ComposedPairsRecord } from '../src/lib/stages-experimental/layout-composed-pairs-gate-and-defer.js';
import { checkPairAnswers } from './pairs-attribution.js';

const FOCUS_TREE = [
  'V:2,1',
  'ID:calendar-main',
  'H',
  'ID:weather-main',
  'ID:tasks-main',
] as TilingNode[];

const ROW = [
  'V:1,1,1',
  'ID:calendar-main',
  'ID:weather-main',
  'ID:tasks-main',
] as TilingNode[];

function answered(choices: readonly string[]): ComposedPairsRecord {
  const pairs = [
    ['calendar-main', 'weather-main'],
    ['calendar-main', 'tasks-main'],
    ['weather-main', 'tasks-main'],
  ] as const;
  return {
    route: 'spatial',
    called: true,
    pairs: pairs.map(([first, second], index) => ({
      first: InstanceId(first),
      second: InstanceId(second),
      answer: {
        choice: choices[index] ?? 'not_stated',
        confidence: 1,
        probabilities: { [choices[index] ?? 'not_stated']: 1 },
      },
    })),
    candidates: [
      { tree: ROW, score: -1, fits: true },
      { tree: FOCUS_TREE, score: -2, fits: true },
    ],
    chosen: 0,
    margin: 1,
  };
}

describe('checkPairAnswers', () => {
  test('reads not stated as the current relation and checks the candidates', () => {
    const check = checkPairAnswers(
      answered(['left_of', 'not_stated', 'left_of']),
      FOCUS_TREE,
      ROW,
      ROW,
    );
    expect(check).toEqual({
      compared: 3,
      wrongAnswers: ['weather-main / tasks-main'],
      notStated: 1,
      wrongInTree: ['weather-main / tasks-main'],
      referenceInCandidates: true,
    });
  });

  test('cannot compare when an answered Instance is missing from the reference', () => {
    expect(
      checkPairAnswers(
        answered([]),
        ['V', 'ID:calendar-main', 'ID:weather-main'],
        ROW,
        undefined,
      ),
    ).toBe('calendar-main or tasks-main is not in the reference tree');
  });
});

describe('checkPairAnswers direction', () => {
  const withDirection = (choice: string): ComposedPairsRecord => ({
    ...answered(['left_of', 'left_of', 'above']),
    direction: { choice, confidence: 1, probabilities: { [choice]: 1 } },
  });

  test('compares the direction answer with the reference top split', () => {
    const check = checkPairAnswers(
      withDirection('stacked'),
      FOCUS_TREE,
      ROW,
      FOCUS_TREE,
    );
    expect(typeof check !== 'string' && check.direction).toEqual({
      wrong: true,
      notStated: false,
    });
  });

  test('reads a not stated direction as the current top split', () => {
    const check = checkPairAnswers(
      withDirection('not_stated'),
      FOCUS_TREE,
      ROW,
      FOCUS_TREE,
    );
    expect(typeof check !== 'string' && check.direction).toEqual({
      wrong: false,
      notStated: true,
    });
  });

  test('records no direction for a call that did not ask it', () => {
    const check = checkPairAnswers(
      answered(['left_of', 'left_of', 'above']),
      FOCUS_TREE,
      ROW,
      FOCUS_TREE,
    );
    expect(typeof check !== 'string' && check.direction).toBeUndefined();
  });
});
