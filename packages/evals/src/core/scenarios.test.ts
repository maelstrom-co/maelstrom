import { describe, expect, test } from 'bun:test';

import { type TilingNode, VesselSchema } from '@maelstrom-co/protocol';

import { workspaceVessels } from './fixtures/workspace-vessels.js';
import { checkArrangement } from './predicates.js';
import { request, scenarios, selectScenarios } from './scenarios.js';

describe('scenarios', () => {
  test('ids are unique', () => {
    const ids = scenarios.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('holdout ids, and only they, start hold-', () => {
    const mismatched = scenarios.filter(
      (scenario) =>
        scenario.id.startsWith('hold-') !== (scenario.suite === 'holdout'),
    );
    expect(mismatched.map((scenario) => scenario.id)).toEqual([]);
  });

  test('every recorded tree satisfies its own arrangement rules', () => {
    const failures = scenarios.flatMap((scenario) => {
      const rules = scenario.expected.arrangement;
      if (!rules) return [];
      const current =
        scenario.request.layout.type === 'tiling'
          ? scenario.request.layout.tree
          : [];
      const tree = (scenario.expected.tree ?? current) as TilingNode[];
      return checkArrangement(rules, {
        request: scenario.request,
        tree,
      }).failures.map((failure) => `${scenario.id}: ${failure}`);
    });
    expect(failures).toEqual([]);
  });

  test.each([
    [
      'half-of-left-column-nested',
      [
        'H:5,2',
        'V:1,2,1',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:map-main',
        'ID:weather-main',
      ],
    ],
    [
      'full-height-column-keep-row',
      [
        'V:3,2,2,4',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:journal-main',
        'H',
        'ID:map-main',
        'ID:weather-main',
      ],
    ],
    [
      'narrow-column-pair',
      [
        'H:4,3,5,4',
        'ID:calendar-main',
        'ID:tasks-main',
        'V:1,2',
        'ID:journal-main',
        'ID:map-main',
        'ID:weather-main',
      ],
    ],
    [
      'narrow-column-pair',
      [
        'V:1,1,1,4',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:journal-main',
        'H',
        'ID:map-main',
        'ID:weather-main',
      ],
    ],
    [
      'bottom-strip',
      ['H:5,5,3', 'ID:calendar-main', 'ID:map-main', 'ID:weather-main'],
    ],
    [
      'bottom-strip-keep-row',
      ['H:5,5,3', 'ID:calendar-main', 'ID:map-main', 'ID:weather-main'],
    ],
  ])('%s fails on a tree a logged or recorded run shipped', (id, tree) => {
    const scenario = scenarios.find((candidate) => candidate.id === id);
    const rules = scenario?.expected.arrangement;
    if (scenario === undefined || rules === undefined)
      throw new Error(`no rules for ${id}`);
    expect(
      checkArrangement(rules, {
        request: scenario.request,
        tree: tree as TilingNode[],
      }).failures,
    ).not.toEqual([]);
  });

  test('every scenario with rules is tagged, and rules only appear on planned ones', () => {
    for (const scenario of scenarios)
      if (scenario.expected.arrangement) {
        expect(scenario.spatial).toBeBoolean();
        expect(scenario.expected.status).toBe('planned');
      }
  });

  test('development has enough explicit arrangements and non-spatial controls', () => {
    const development = selectScenarios('development');
    const arranged = development.filter(
      (scenario) => scenario.spatial === true && scenario.expected.arrangement,
    );
    const controls = development.filter(
      (scenario) => scenario.spatial === false,
    );
    expect(arranged.length).toBeGreaterThanOrEqual(10);
    expect(controls.length).toBeGreaterThanOrEqual(6);
    const holdout = selectScenarios('holdout');
    expect(
      holdout.filter((scenario) => scenario.id.startsWith('hold-arr-')),
    ).toHaveLength(4);
    expect(
      holdout.filter((scenario) => scenario.id.startsWith('hold-ctl-')),
    ).toHaveLength(3);
    expect(
      holdout.filter((scenario) => scenario.id.startsWith('hold-inner-')),
    ).toHaveLength(8);
    expect(
      holdout.filter((scenario) => scenario.id.startsWith('hold-fresh-')),
    ).toHaveLength(11);
    for (const id of ['swap', 'big-right', 'top-and-pair', 'bottom-strip'])
      expect(
        development.find((scenario) => scenario.id === id)?.expected.status,
      ).toBe('planned');
  });
});

describe('request', () => {
  test('builds the demo board by default, as every existing scenario does', () => {
    const [swap] = selectScenarios('all', ['swap']);
    expect(
      request('Swap the calendar and the map.', {
        tree: ['V', 'ID:calendar-main', 'ID:map-main'],
      }),
    ).toEqual(swap?.request as never);
  });

  test('builds one Instance per named Vessel on another vessel set', () => {
    const built = request('Show the contacts.', {
      instances: ['player', 'watchlist', 'contacts'],
      vessels: workspaceVessels,
      tree: ['V', 'ID:player-main', 'ID:watchlist-main'],
    });
    expect(built.instances).toEqual([
      {
        instanceId: 'player-main',
        vesselId: 'player',
        variant: 'nowPlaying',
      },
      { instanceId: 'watchlist-main', vesselId: 'watchlist', variant: 'list' },
      { instanceId: 'contacts-main', vesselId: 'contacts', variant: 'list' },
    ] as never);
    expect(built.vessels).toEqual(workspaceVessels as never);
  });

  test('refuses named Instances without a tree, since the default tree names demo ones', () => {
    expect(() =>
      request('Show the contacts.', {
        instances: ['player', 'watchlist', 'contacts'],
        vessels: workspaceVessels,
      }),
    ).toThrow();
  });

  test('every workspace Vessel parses', () => {
    expect(workspaceVessels.map((vessel) => String(vessel.id))).toEqual([
      'player',
      'watchlist',
      'contacts',
    ]);
    for (const vessel of workspaceVessels)
      expect(VesselSchema.safeParse(vessel).success).toBe(true);
  });
});
