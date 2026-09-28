import { describe, expect, test } from 'bun:test';
import type { JevCall } from '@maelstrom-co/planner-jev/_internal';
import { layoutComposedPairsGateAndDefer } from '@maelstrom-co/planner-jev/_internal';
import {
  type Script,
  scriptedFetch,
  TEST_MODEL,
} from '@maelstrom-co/planner-jev/_testing';
import { selectScenarios } from '../../../core/scenarios.js';
import {
  runStageEval,
  type StageTurnRecord,
} from '../../../core/stage-eval.js';
import { recordedSpatialSignal } from '../recorded-spatial.js';
import { typesafeSettings } from '../typesafe-settings.js';
import {
  LAYOUT_STAGES,
  type LayoutModuleOptions,
  type LayoutTurnDetail,
  layoutModuleWith,
} from './layout.js';

/** Answers every pair question with the map left of the calendar, and every size as an equal share. */
const SWAP_CORRECT: Script = (payload) => ({
  choices: Object.fromEntries(
    Object.keys(payload.questions)
      .filter((id) => id.startsWith('pair/'))
      .map((id) => [
        id,
        id.startsWith('pair/map-main/') ? 'left_of' : 'right_of',
      ]),
  ),
  scores: Object.fromEntries(
    Object.keys(payload.questions)
      .filter((id) => id.startsWith('size/'))
      .map((id) => [id, 2]),
  ),
});

async function run(
  ids: readonly string[],
  variants: readonly string[],
  script: Script = SWAP_CORRECT,
  repeats = 1,
  options: Omit<LayoutModuleOptions, 'typesafe'> = {},
) {
  const transport = scriptedFetch(script);
  const module = layoutModuleWith({
    ...options,
    typesafe: typesafeSettings({
      apiKey: 'typesafe-test-key',
      model: TEST_MODEL,
      fetch: transport.fetch,
    }),
  });
  const records = (await runStageEval(module, {
    scenarios: selectScenarios('all', ids),
    variants,
    repeats,
  })) as StageTurnRecord<LayoutTurnDetail>[];
  return { records, payloads: transport.calls };
}

/** The Jev calls of a turn, with the state each one sent. */
function jevCalls(record: StageTurnRecord<LayoutTurnDetail>) {
  return record.calls as readonly (JevCall & { readonly state?: unknown })[];
}

describe('layout stage eval', () => {
  test('calls the stage directly on gold inputs, with one Jev call and no LLM', async () => {
    const { records, payloads } = await run(['swap'], ['composed-pairs']);
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record.outcome).toBe('pass');
    expect(record.stage).toBe('jevLayout');
    expect(record.failures).toEqual([]);
    expect(payloads).toHaveLength(1);
    expect(Object.keys(payloads[0].questions)).toContain(
      'pair/calendar-main/map-main',
    );
    expect(jevCalls(record)).toHaveLength(1);
    expect(
      jevCalls(record)[0].answers?.['pair/calendar-main/map-main']?.choice,
    ).toBe('right_of');
    expect(jevCalls(record)[0].state).toMatchObject({
      currentArrangement: expect.any(String),
    });
    expect(record.detail?.pairwise?.route).toBe('spatial');
    expect(record.detail?.tree).toEqual([
      'V',
      'ID:map-main',
      'ID:calendar-main',
    ]);
  });

  test('counts a decision without a tree as handed off', async () => {
    const { records } = await run(['swap'], ['preset-or-llm'], () => ({
      choices: {},
      nouls: { needsChange: 0.9, needsBetter: 0.9 },
    }));
    const [record] = records;
    expect(record.outcome).toBe('handed_off');
    expect(record.failures).toEqual([]);
    expect(record.detail?.tree).toBeUndefined();
  });

  test('scores a wrong tree as a fail and names the failed rule', async () => {
    const { records } = await run(['swap'], ['composed-pairs'], (payload) => ({
      choices: Object.fromEntries(
        Object.keys(payload.questions)
          .filter((id) => id.startsWith('pair/'))
          .map((id) => [id, 'left_of']),
      ),
    }));
    const [record] = records;
    expect(record.outcome).toBe('fail');
    expect(record.failures.some((failure) => failure.includes('leftOf'))).toBe(
      true,
    );
  });

  test('records a scenario that cannot form gold inputs once per variant, and runs nothing', async () => {
    const { records, payloads } = await run(
      ['missing-enum'],
      ['composed-pairs', 'preset'],
      SWAP_CORRECT,
      3,
    );
    expect(payloads).toHaveLength(0);
    expect(records.map((record) => [record.variant, record.outcome])).toEqual([
      ['composed-pairs', 'not_applicable'],
      ['preset', 'not_applicable'],
    ]);
    expect(records[0].reason).toBe('expects a deferral');
  });

  test('records a provider failure as a deferral', async () => {
    const { records } = await run(['swap'], ['composed-pairs'], () => ({
      status: 500,
    }));
    expect(records[0].outcome).toBe('deferred');
    expect(records[0].reason).toBe('jevLayout/provider_http');
    expect(jevCalls(records[0])[0].outcome).toBe('provider_http');
  });

  test('rejects an unknown variant before running', async () => {
    await expect(run(['swap'], ['no-such-variant'])).rejects.toThrow(
      /unknown jevLayout variant no-such-variant/,
    );
  });

  test('scores a scenario that expects a layout stage deferral: only deferring with no feasible layout passes', async () => {
    const { records } = await run(
      ['small-chart'],
      ['preset-or-llm', 'composed-pairs'],
      pairsAll('left_of'),
    );
    expect(
      records.map((record) => [
        record.variant,
        record.outcome,
        record.expectedDeferral,
      ]),
    ).toEqual([
      ['preset-or-llm', 'pass', 'jevLayout/no_feasible_layout'],
      ['composed-pairs', 'pass', 'jevLayout/no_feasible_layout'],
    ]);
    expect(records[1].reason).toBe('jevLayout/no_feasible_layout');
  });

  test('feeds the recorded live spatial signal per scenario and repeat, and gold where none was recorded', async () => {
    const signal = recordedSpatialSignal(
      [
        {
          arm: 'live-arm',
          scenarioId: 'swap',
          repeat: 1,
          stageOutputs: {
            jevSelect: {
              gates: {
                spatial: { answer: 'no', probability: 0.47, confidence: 0.6 },
              },
            },
          },
        },
      ],
      'live-arm',
    );
    const { records, payloads } = await run(
      ['swap'],
      ['composed-pairs'],
      pairsAll('not_stated'),
      2,
      { spatialSignal: signal },
    );
    expect(
      records.map((record) => [
        record.repeat,
        record.variant,
        record.detail?.pairwise?.route,
        record.detail?.pairwise?.called,
      ]),
    ).toEqual([
      [1, 'composed-pairs', 'same_instances', true],
      [2, 'composed-pairs', 'spatial', true],
    ]);
    expect(payloads).toHaveLength(2);
  });

  test('marks whether a turn that asks no arrangement changed the layout', async () => {
    const kept = await run(
      ['preserve', 'swap'],
      ['composed-pairs'],
      pairsAll('not_stated'),
    );
    expect(
      kept.records.map((record) => [
        record.scenarioId,
        record.detail?.arrangementNotAsked,
      ]),
    ).toEqual([
      ['preserve', { changed: false }],
      ['swap', undefined],
    ]);
    const moved = await run(
      ['preserve'],
      ['composed-pairs'],
      pairsAll('above'),
    );
    expect(moved.records[0].detail?.arrangementNotAsked).toEqual({
      changed: true,
    });
  });

  test('the composed pairs variant asks on a recorded no and defers when nothing fits', async () => {
    const signal = recordedSpatialSignal(
      [
        {
          arm: 'live-arm',
          scenarioId: 'swap',
          repeat: 1,
          stageOutputs: {
            jevSelect: {
              gates: {
                spatial: { answer: 'no', probability: 0.1, confidence: 0.9 },
              },
            },
          },
        },
      ],
      'live-arm',
    );
    const { records } = await run(
      ['swap', 'small-chart'],
      ['composed-pairs'],
      pairsAll('left_of'),
      1,
      { spatialSignal: signal },
    );
    const byScenario = Object.fromEntries(
      records.map((record) => [record.scenarioId, record]),
    );
    expect(byScenario.swap?.detail?.pairwise?.called).toBe(true);
    expect(byScenario['small-chart']).toMatchObject({
      outcome: 'pass',
      reason: 'jevLayout/no_feasible_layout',
    });
  });
});

describe('the composed pairs gate and defer layout', () => {
  test('is the stage eval variant the planner arm uses', () => {
    expect(LAYOUT_STAGES['composed-pairs']).toBe(
      layoutComposedPairsGateAndDefer,
    );
  });
});

function pairsAll(choice: string): Script {
  return (payload) => ({
    choices: Object.fromEntries(
      Object.keys(payload.questions)
        .filter((id) => id.startsWith('pair/'))
        .map((id) => [id, choice]),
    ),
    scores: Object.fromEntries(
      Object.keys(payload.questions)
        .filter((id) => id.startsWith('size/'))
        .map((id) => [id, 2]),
    ),
  });
}
