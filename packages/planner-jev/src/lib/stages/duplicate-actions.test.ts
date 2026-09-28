import { describe, expect, test } from 'bun:test';

import { actionKey, keepFirstOfEachKey } from './duplicate-actions.js';

describe('actionKey', () => {
  test('ignores parameter order at every depth', () => {
    expect(
      actionKey('calendar-main', 'moveEvent', {
        title: 'Gym',
        time: { hour: 8, minute: 0 },
      }),
    ).toBe(
      actionKey('calendar-main', 'moveEvent', {
        time: { minute: 0, hour: 8 },
        title: 'Gym',
      }),
    );
  });

  test('keeps the order of array items', () => {
    expect(
      actionKey('tasks-main', 'importTasks', { payload: [1, 2] }),
    ).not.toBe(actionKey('tasks-main', 'importTasks', { payload: [2, 1] }));
  });

  test.each([
    [
      'a different value',
      'calendar-main',
      'moveEvent',
      { title: 'Design review' },
    ],
    ['a different action', 'calendar-main', 'removeEvent', { title: 'Gym' }],
    ['a different instance', 'calendar-2', 'moveEvent', { title: 'Gym' }],
    [
      'an extra parameter',
      'calendar-main',
      'moveEvent',
      { title: 'Gym', time: '8:00' },
    ],
    [
      'a value of another type',
      'calendar-main',
      'moveEvent',
      { title: ['Gym'] },
    ],
  ])('differs for %s', (_name, instanceId, action, params) => {
    expect(actionKey(instanceId, action, params)).not.toBe(
      actionKey('calendar-main', 'moveEvent', { title: 'Gym' }),
    );
  });
});

describe('keepFirstOfEachKey', () => {
  test('keeps the first item of each key in order and returns the rest as dropped', () => {
    const { kept, dropped } = keepFirstOfEachKey(
      ['a1', 'b1', 'a2', 'c1', 'b2'],
      (item) => item[0],
    );
    expect(kept).toEqual(['a1', 'b1', 'c1']);
    expect(dropped).toEqual(['a2', 'b2']);
  });

  test('never drops an item without a key', () => {
    const { kept, dropped } = keepFirstOfEachKey(
      ['a1', 'x', 'x', 'a2'],
      (item) => (item === 'x' ? undefined : item[0]),
    );
    expect(kept).toEqual(['a1', 'x', 'x']);
    expect(dropped).toEqual(['a2']);
  });
});
