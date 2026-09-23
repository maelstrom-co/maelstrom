import { describe, expect, test } from 'bun:test';

import type { ComposedAnswers } from '../src/lib/stages-experimental/layout-composed.js';
import {
  checkComposedAnswers,
  firstWrongQuestion,
  referenceAnswers,
} from './composed-attribution.js';

const FOCUS_TREE = [
  'V:2,1',
  'ID:calendar-main',
  'H',
  'ID:weather-main',
  'ID:tasks-main',
];

function answers(
  shape: string,
  placements: Record<string, string>,
  positions: Record<string, string>,
): ComposedAnswers {
  const recorded = (choice: string) => ({
    choice,
    confidence: 1,
    probabilities: { [choice]: 1 },
  });
  return {
    shape: recorded(shape),
    placements: Object.fromEntries(
      Object.entries(placements).map(([id, part]) => [id, recorded(part)]),
    ),
    positions: Object.fromEntries(
      Object.entries(positions).map(([id, position]) => [
        id,
        recorded(position),
      ]),
    ),
    sizes: {},
  };
}

describe('composed answer attribution', () => {
  test('reads the shape, parts and positions a reference tree implies', () => {
    expect(referenceAnswers(FOCUS_TREE)).toEqual({
      shape: 'side_by_side_2',
      placements: {
        'calendar-main': 'part_1',
        'weather-main': 'part_2',
        'tasks-main': 'part_2',
      },
      positions: {
        'calendar-main': 'first',
        'weather-main': 'first',
        'tasks-main': 'second',
      },
    });
  });

  test('refuses a reference tree that is not a composed shape', () => {
    expect(referenceAnswers(['ID:calendar-main'])).toBe(
      'the reference tree is a single leaf',
    );
    expect(
      referenceAnswers(['V', 'ID:a', 'H', 'ID:b', 'V', 'ID:c', 'ID:d']),
    ).toBe('the reference tree splits deeper than a part');
  });

  test('names every wrong answer and attributes the miss to the first kind', () => {
    const check = checkComposedAnswers(
      answers(
        'side_by_side_2',
        {
          'calendar-main': 'part_1',
          'weather-main': 'part_2',
          'tasks-main': 'part_2',
        },
        {
          'calendar-main': 'first',
          'weather-main': 'second',
          'tasks-main': 'first',
        },
      ),
      FOCUS_TREE,
    );
    if (typeof check === 'string') throw new Error(check);
    expect(check.wrong).toEqual({
      shape: false,
      placements: [],
      positions: ['weather-main', 'tasks-main'],
    });
    expect(firstWrongQuestion(check)).toBe('position');
  });

  test('attributes a miss with every answer right to size', () => {
    const check = checkComposedAnswers(
      answers(
        'side_by_side_2',
        {
          'calendar-main': 'part_1',
          'weather-main': 'part_2',
          'tasks-main': 'part_2',
        },
        {
          'calendar-main': 'first',
          'weather-main': 'first',
          'tasks-main': 'second',
        },
      ),
      FOCUS_TREE,
    );
    if (typeof check === 'string') throw new Error(check);
    expect(firstWrongQuestion(check)).toBe('size');
  });

  test('cannot compare an answered Instance the reference tree lacks', () => {
    expect(
      checkComposedAnswers(
        answers('stacked_2', { 'map-main': 'part_1' }, {}),
        FOCUS_TREE,
      ),
    ).toBe('map-main is not in the reference tree');
  });
});
