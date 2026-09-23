import { describe, expect, test } from 'bun:test';

import { selectScenarios } from '../eval/scenarios.js';
import {
  type Script,
  scriptedFetch,
  TEST_MODEL,
} from '../src/lib/__test-helpers__/scripted-fetch.js';
import { type LayoutTurnDetail, layoutStageEval } from './layout.js';
import { runStageEval, type StageTurnRecord } from './stage-eval.js';

const SWAP_CORRECT = {
  choices: {
    shape: 'side_by_side_2',
    'placement/map-main': 'part_1',
    'placement/calendar-main': 'part_2',
    'position/map-main': 'first',
    'position/calendar-main': 'first',
  },
};

async function run(
  ids: readonly string[],
  variants: readonly string[],
  script: Script = () => SWAP_CORRECT,
  repeats = 1,
) {
  const transport = scriptedFetch(script);
  const records = (await runStageEval(layoutStageEval, {
    scenarios: selectScenarios('all', ids),
    variants,
    repeats,
    typesafe: {
      apiKey: 'typesafe-test-key',
      model: TEST_MODEL,
      fetch: transport.fetch,
    },
  })) as StageTurnRecord<LayoutTurnDetail>[];
  return { records, payloads: transport.calls };
}

describe('layout stage eval', () => {
  test('calls the stage directly on gold inputs, with one Jev call and no LLM', async () => {
    const { records, payloads } = await run(['swap'], ['composed']);
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record.outcome).toBe('pass');
    expect(record.stage).toBe('jevLayout');
    expect(record.failures).toEqual([]);
    expect(payloads).toHaveLength(1);
    expect(Object.keys(payloads[0].questions)).toContain('shape');
    expect(record.jevCalls).toHaveLength(1);
    expect(record.jevCalls[0].answers?.shape?.choice).toBe('side_by_side_2');
    expect(record.jevCalls[0].state).toMatchObject({
      currentArrangement: expect.any(String),
    });
    expect(record.detail?.composition?.route).toBe('spatial');
    expect(record.detail?.tree).toEqual([
      'V',
      'ID:map-main',
      'ID:calendar-main',
    ]);
    expect(record.detail?.miss).toBeUndefined();
  });

  test('counts a decision without a tree as handed off and attributes it', async () => {
    const { records } = await run(['swap'], ['composed'], () => ({
      choices: { ...SWAP_CORRECT.choices, shape: 'none_of_these' },
    }));
    const [record] = records;
    expect(record.outcome).toBe('handed_off');
    expect(record.failures).toEqual([]);
    expect(record.detail?.composition?.handOff).toBe('none_of_these');
    expect(record.detail?.miss).toEqual({ question: 'shape' });
  });

  test('scores a wrong tree as a fail and names the wrong placements', async () => {
    const { records } = await run(['swap'], ['composed'], () => ({
      choices: {
        ...SWAP_CORRECT.choices,
        'placement/map-main': 'part_2',
        'placement/calendar-main': 'part_1',
      },
    }));
    const [record] = records;
    expect(record.outcome).toBe('fail');
    expect(record.failures.some((failure) => failure.includes('leftOf'))).toBe(
      true,
    );
    expect(record.detail?.miss).toEqual({ question: 'placement' });
    expect(record.detail?.answerCheck).toMatchObject({
      wrong: {
        shape: false,
        placements: ['calendar-main', 'map-main'],
        positions: [],
      },
    });
  });

  test('records a scenario that cannot form gold inputs once per variant, and runs nothing', async () => {
    const { records, payloads } = await run(
      ['missing-enum'],
      ['composed', 'preset'],
      () => SWAP_CORRECT,
      3,
    );
    expect(payloads).toHaveLength(0);
    expect(records.map((record) => [record.variant, record.outcome])).toEqual([
      ['composed', 'not_applicable'],
      ['preset', 'not_applicable'],
    ]);
    expect(records[0].reason).toBe('expects a deferral');
  });

  test('records a provider failure as a deferral', async () => {
    const { records } = await run(['swap'], ['composed'], () => ({
      status: 500,
    }));
    expect(records[0].outcome).toBe('deferred');
    expect(records[0].reason).toBe('jevLayout/provider_http');
    expect(records[0].jevCalls[0].outcome).toBe('provider_http');
  });

  test('runs the variants that make no Jev call without a transport call', async () => {
    const { records, payloads } = await run(
      ['swap', 'preserve'],
      ['spatial-gate', 'always-llm'],
    );
    expect(payloads).toHaveLength(0);
    expect(
      records.map((record) => [
        record.scenarioId,
        record.variant,
        record.outcome,
      ]),
    ).toEqual([
      ['preserve', 'spatial-gate', 'pass'],
      ['preserve', 'always-llm', 'handed_off'],
      ['swap', 'spatial-gate', 'handed_off'],
      ['swap', 'always-llm', 'handed_off'],
    ]);
  });

  test('keeps the current tree without a call on the same Instances and no stated arrangement', async () => {
    const { records, payloads } = await run(['preserve'], ['composed']);
    expect(payloads).toHaveLength(0);
    expect(records[0].outcome).toBe('pass');
    expect(records[0].detail?.composition).toMatchObject({
      route: 'same_instances',
      called: false,
    });
  });

  test('rejects an unknown variant before running', async () => {
    await expect(run(['swap'], ['no-such-variant'])).rejects.toThrow(
      /unknown jevLayout variant no-such-variant/,
    );
  });
});
