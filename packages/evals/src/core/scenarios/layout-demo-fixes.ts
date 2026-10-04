import type { deferred, planned, Scenario, spatial } from '../scenarios.js';

/** The scenario builders {@link layoutDemoFixScenarios} takes from `scenarios.ts`. */
export interface LayoutDemoFixBuilders {
  readonly planned: typeof planned;
  readonly deferred: typeof deferred;
  readonly spatial: typeof spatial;
}

/**
 * Arrangement requests: a whole-board grid that names no widget's place,
 * which pair questions cannot express and so should defer rather than
 * leave the board unchanged, and a size-only request that moves no widget
 * yet must still be planned.
 */
export function layoutDemoFixScenarios({
  planned,
  deferred,
  spatial,
}: LayoutDemoFixBuilders): readonly Scenario[] {
  const unstatedGrid = (scenario: Scenario): Scenario =>
    spatial({
      ...scenario,
      expected: { ...scenario.expected, deferCause: 'arrangement_not_stated' },
    });
  return [
    unstatedGrid(
      deferred(
        'grid-without-quadrants',
        'A grid that places no widget',
        'Arrange everything in a 2x2 grid.',
        'layout',
        { tree: [...ONE_ROW] },
      ),
    ),
    {
      ...unstatedGrid(
        deferred(
          'hold-grid-without-quadrants',
          'A grid of a stacked board that places no widget',
          'Put the four widgets in a grid.',
          'layout',
          { tree: [...ONE_COLUMN] },
        ),
      ),
      suite: 'holdout',
    },
    spatial(
      planned(
        'weather-bigger-size-only',
        'Grow one widget without moving any',
        'Make the weather bigger.',
        {
          visible: ['calendar-main', 'weather-main', 'tasks-main'],
          actions: [],
          tree: [
            'V:2,3,2',
            'ID:calendar-main',
            'ID:weather-main',
            'ID:tasks-main',
          ],
          arrangement: [
            {
              kind: 'weightRatio',
              a: 'weather-main',
              b: 'calendar-main',
              min: 1.2,
              max: 10,
            },
            {
              kind: 'weightRatio',
              a: 'weather-main',
              b: 'tasks-main',
              min: 1.2,
              max: 10,
            },
          ],
        },
      ),
    ),
  ];
}

const FOUR_WIDGETS = [
  'ID:calendar-main',
  'ID:weather-main',
  'ID:tasks-main',
  'ID:map-main',
];

const ONE_ROW = ['V:1,1,1,1', ...FOUR_WIDGETS];

const ONE_COLUMN = ['H:1,1,1,1', ...FOUR_WIDGETS];
