import { describe, expect, test } from 'bun:test';
import type { TilingNode } from '@maelstrom-co/protocol';
import { makeRequest } from './__test-helpers__/fixtures.js';
import type { Arranged } from './predicates.js';
import { VERBALIZER_VERSION, verbalizeTree } from './verbalize-tree.js';

const request = makeRequest('describe', { columns: 12, rows: 6 });

function board(tree: readonly (string | null)[]): Arranged {
  return { request, tree: tree as readonly TilingNode[] };
}

describe('verbalizeTree', () => {
  test('stamps the version on the first line', () => {
    const output = verbalizeTree(board(['ID:calendar-main']));
    expect(output.split('\n')[0]).toBe(`verbalize-tree v${VERBALIZER_VERSION}`);
  });

  test('describes a flat two-leaf split', () => {
    const flat = board(['V', 'ID:calendar-main', 'ID:weather-main']);
    expect(verbalizeTree(flat)).toBe(
      [
        `verbalize-tree v${VERBALIZER_VERSION}`,
        'calendar left of weather',
        'calendar-main: calendar (month), columns 0-6 of 12, rows 0-6 of 6, area 1/2',
        'weather-main: weather (current), columns 6-12 of 12, rows 0-6 of 6, area 1/2',
      ].join('\n'),
    );
  });

  test('describes a nested split with unequal weights', () => {
    const nested = board([
      'V:2,1',
      'ID:calendar-main',
      'H',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
    expect(verbalizeTree(nested)).toBe(
      [
        `verbalize-tree v${VERBALIZER_VERSION}`,
        'left 2/3: calendar; right 1/3: weather above tasks',
        'calendar-main: calendar (month), columns 0-8 of 12, rows 0-6 of 6, area 2/3',
        'weather-main: weather (current), columns 8-12 of 12, rows 0-3 of 6, area 1/6',
        'tasks-main: tasks (list), columns 8-12 of 12, rows 3-6 of 6, area 1/6',
      ].join('\n'),
    );
  });

  test('describes a single leaf filling the chart', () => {
    expect(verbalizeTree(board(['ID:calendar-main']))).toBe(
      [
        `verbalize-tree v${VERBALIZER_VERSION}`,
        'calendar',
        'calendar-main: calendar (month), columns 0-12 of 12, rows 0-6 of 6, area 1/1',
      ].join('\n'),
    );
  });

  test('describes an empty layout', () => {
    expect(verbalizeTree(board([]))).toBe(
      [`verbalize-tree v${VERBALIZER_VERSION}`, '(empty)'].join('\n'),
    );
  });

  test('describes a reserved but empty slot', () => {
    const reserved = board(['V', 'ID:calendar-main', null]);
    expect(verbalizeTree(reserved)).toBe(
      [
        `verbalize-tree v${VERBALIZER_VERSION}`,
        'calendar left of empty',
        'calendar-main: calendar (month), columns 0-6 of 12, rows 0-6 of 6, area 1/2',
      ].join('\n'),
    );
  });

  test('describes an equal three-way split as a chain', () => {
    const thirds = board([
      'V:1,1,1',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
    expect(verbalizeTree(thirds)).toBe(
      [
        `verbalize-tree v${VERBALIZER_VERSION}`,
        'calendar left of weather left of tasks',
        'calendar-main: calendar (month), columns 0-4 of 12, rows 0-6 of 6, area 1/3',
        'weather-main: weather (current), columns 4-8 of 12, rows 0-6 of 6, area 1/3',
        'tasks-main: tasks (list), columns 8-12 of 12, rows 0-6 of 6, area 1/3',
      ].join('\n'),
    );
  });

  test('reads a nested split as a parenthesized child', () => {
    const nested = board([
      'V',
      'H',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
    expect(verbalizeTree(nested).split('\n')[1]).toBe(
      '(calendar above weather) left of tasks',
    );
  });
});
