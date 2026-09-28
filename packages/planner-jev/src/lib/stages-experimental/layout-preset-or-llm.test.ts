import { describe, expect, test } from 'bun:test';

import { type ChartRequest, isOk } from '@maelstrom-co/protocol';

import {
  deferralOf,
  makeContext,
  makeRequest,
  vessels,
} from '../__test-helpers__/fixtures.js';
import {
  actionPlan,
  withMinSizes,
} from '../__test-helpers__/layout-fixtures.js';
import type {
  Payload,
  Script,
  Step,
} from '../__test-helpers__/scripted-fetch.js';
import { scriptedAsk } from '../__test-helpers__/scripted-fetch.js';
import type { ActionPlan2 } from '../stages/stage-types.js';
import { layoutPresetOrLlm } from './layout-preset-or-llm.js';

function planOf(request: ChartRequest): ActionPlan2 {
  return { ...actionPlan(request), minConfidence: 1 };
}

/** Answers `needsChange` and `needsBetter` as nouls, and `layout` by option id (first offered if omitted). */
function script(options: {
  readonly needsChange?: 'yes' | 'no';
  readonly needsBetter?: 'yes' | 'no';
  readonly layout?: string | ((payload: Payload) => string);
}): Script {
  return (payload) => {
    const layout =
      typeof options.layout === 'function'
        ? options.layout(payload)
        : options.layout;
    const step: Step = {
      choices: layout === undefined ? {} : { layout },
      nouls: {
        needsChange: options.needsChange === 'yes' ? 1 : 0,
        needsBetter: options.needsBetter === 'yes' ? 1 : 0,
      },
    };
    return step;
  };
}

async function run(plan: ActionPlan2, s: Script) {
  const { ask, calls } = scriptedAsk(s);
  const result = await layoutPresetOrLlm(ask)(
    plan,
    makeContext(plan.selection.input),
  );
  return { result, calls };
}

describe('layoutPresetOrLlm', () => {
  test('no change: keeps the current tree when it still fits', async () => {
    const plan = planOf(makeRequest('set the weather to Tokyo'));
    const { result } = await run(
      plan,
      script({ needsChange: 'no', needsBetter: 'no' }),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('preserve');
  });

  test('no change wins over needing better, even when needsBetter answers yes', async () => {
    const plan = planOf(makeRequest('set the weather to Tokyo'));
    const { result } = await run(
      plan,
      script({ needsChange: 'no', needsBetter: 'yes' }),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('preserve');
  });

  test('needs a change and none offered fits: hands the layout off', async () => {
    const plan = planOf(makeRequest('arrange them in a spiral'));
    const { result } = await run(
      plan,
      script({ needsChange: 'yes', needsBetter: 'yes' }),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('llm');
    expect(result.value.tree).toBeUndefined();
  });

  test('needs a change and one offered fits: ships the chosen option', async () => {
    const plan = planOf(makeRequest('stack them'));
    const { result } = await run(
      plan,
      script({ needsChange: 'yes', needsBetter: 'no', layout: 'column' }),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('jev');
    expect(result.value.layoutId).toBe('column');
  });

  test('records all three answers on every route', async () => {
    const plan = planOf(makeRequest('stack them'));
    const { result } = await run(
      plan,
      script({ needsChange: 'yes', needsBetter: 'no', layout: 'column' }),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.answers.map((a) => a.question)).toEqual([
      'needsChange',
      'layout',
      'needsBetter',
    ]);
  });

  test('falls back to the balanced default when no change is needed and preserve no longer fits', async () => {
    const request = makeRequest('hide the tasks');
    const hiddenPlan: ActionPlan2 = {
      ...actionPlan(request, [], { 'tasks-main': 'hide' }),
      minConfidence: 1,
    };
    const { result } = await run(
      hiddenPlan,
      script({ needsChange: 'no', needsBetter: 'no' }),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('default');
  });

  test('sends the layout menu, needsChange and needsBetter in one call', async () => {
    const plan = planOf(makeRequest('stack them'));
    const { calls } = await run(
      plan,
      script({ needsChange: 'yes', needsBetter: 'no', layout: 'column' }),
    );
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]?.questions ?? {})).toEqual([
      'needsChange',
      'layout',
      'needsBetter',
    ]);
  });

  test('describes the offered layouts by their Instances and positions', async () => {
    const plan = planOf(makeRequest('stack them'));
    const { calls } = await run(
      plan,
      script({ needsChange: 'yes', needsBetter: 'no', layout: 'column' }),
    );
    const criteria = calls[0]?.questions.layout?.criteria ?? {};
    expect(Object.values(criteria).length).toBeGreaterThan(0);
    for (const description of Object.values(criteria))
      expect(description).toContain('calendar-main');
  });

  test('defers no_feasible_layout without a call when nothing offered fits and it is not visible-empty', async () => {
    const request = makeRequest('set the weather to Tokyo', {
      vessels: withMinSizes(vessels, () => ({ width: 20, height: 20 })),
    });
    const plan = planOf(request);
    const { result, calls } = await run(plan, script({}));
    expect(deferralOf(result)).toBe('jevLayout/no_feasible_layout');
    expect(calls).toEqual([]);
  });
});
