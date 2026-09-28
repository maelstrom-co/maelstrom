import { describe, expect, test } from 'bun:test';

import { type ChartRequest, isOk } from '@maelstrom-co/protocol';

import {
  deferralOf,
  makeContext,
  makeRequest,
  makeResizeRequest,
  plain,
  spyLogger,
  vessels,
} from '../__test-helpers__/fixtures.js';
import {
  actionPlan,
  withMinSizes,
} from '../__test-helpers__/layout-fixtures.js';
import {
  type Script,
  scriptedAsk,
} from '../__test-helpers__/scripted-fetch.js';
import type { SelectionDecision } from '../types.js';
import { jevLayout } from './jev-layout.js';

const FOUR_VISIBLE = [
  'V:1,1,1,1',
  'ID:calendar-main',
  'ID:weather-main',
  'ID:tasks-main',
  'ID:journal-main',
];

async function run(
  request: ChartRequest,
  actions: readonly string[] = [],
  script: Script = () => ({ choices: {} }),
  decisions: Readonly<Record<string, SelectionDecision>> = {},
) {
  const { ask, calls } = scriptedAsk(script);
  const { logger, entries } = spyLogger();
  const plan = actionPlan(request, actions, decisions);
  const result = await jevLayout(ask)(
    plan,
    makeContext(plan.selection.input, { logger }),
  );
  const options = Object.keys(calls[0]?.questions.layout?.criteria ?? {});
  return { result, calls, entries, options };
}

describe('jevLayout', () => {
  test('a transition to a variant with a larger minSize removes candidates that only fit before it', async () => {
    const request = makeRequest('open the Monday entry', {
      tree: FOUR_VISIBLE,
    });
    const before = await run(request);
    const after = await run(request, ['journal-main/openEntry']);
    expect(before.options).toContain('preserve');
    expect(before.options).toContain('row');
    expect(after.options).not.toContain('preserve');
    expect(after.options).not.toContain('row');
    expect(after.options.length).toBeGreaterThan(1);
    expect(after.options).toContain('unavailable');
  });

  test('offers preserve when the visible set is unchanged and still fits', async () => {
    const { options } = await run(makeRequest('set the weather to Tokyo'));
    expect(options[0]).toBe('preserve');
  });

  test('a resized Chart re-filters the candidates', async () => {
    const { options } = await run(makeResizeRequest(12, 20));
    expect(options).not.toContain('preserve');
    expect(options).not.toContain('row');
    expect(options).toContain('column');
  });

  test('returns the tree Jev picks', async () => {
    const { result } = await run(makeRequest('stack them'), [], () => ({
      choices: { layout: 'column' },
    }));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.layoutId).toBe('column');
    expect(plain(result.value.tree)).toEqual([
      'H:1,1,1',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
    expect(result.value.answers).toEqual([
      {
        stage: 'jevLayout',
        question: 'layout',
        choice: 'column',
        confidence: 1,
      },
    ]);
  });

  test('unavailable defers layout_unavailable with the info log', async () => {
    const { result, entries } = await run(makeRequest('four rows'), [], () => ({
      choices: { layout: 'unavailable' },
    }));
    expect(deferralOf(result)).toBe('jevLayout/layout_unavailable');
    expect(entries).toContainEqual({
      level: 'info',
      msg: 'jev.defer',
      data: {
        stage: 'jevLayout',
        reason: 'jevLayout/layout_unavailable',
        question: 'layout',
      },
    });
  });

  test('no feasible candidate defers without a call', async () => {
    const request = makeRequest('arrange', {
      vessels: withMinSizes(vessels, () => ({ width: 20, height: 20 })),
    });
    const { result, calls, entries } = await run(request);
    expect(deferralOf(result)).toBe('jevLayout/no_feasible_layout');
    expect(calls).toHaveLength(0);
    expect(entries.some((e) => e.msg === 'jev.defer')).toBe(true);
  });

  test('an empty visible set makes no call and gives an empty tree', async () => {
    const { result, calls } = await run(
      makeRequest('hide everything'),
      [],
      undefined,
      {
        'calendar-main': 'hide',
        'weather-main': 'hide',
        'tasks-main': 'delete',
      },
    );
    expect(calls).toHaveLength(0);
    expect(isOk(result) && result.value.tree).toEqual([]);
  });
});
