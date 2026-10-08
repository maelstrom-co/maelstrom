import { describe, expect, test } from 'bun:test';
import {
  conversation,
  scriptedFetch,
  TEST_MODEL,
} from '@maelstrom-co/planner-jev/_testing';
import { selectScenarios } from '../../../core/scenarios.js';
import {
  runStageEval,
  type StageTurnRecord,
} from '../../../core/stage-eval.js';
import { typesafeClientBuilder } from '../client-builder.js';
import { typesafeSettings } from '../typesafe-settings.js';
import {
  type ActionsTurnDetail,
  actionsModuleWith,
  renderRepeatedActionsSection,
} from './actions.js';

type Conversation = Parameters<typeof conversation>[0];

const ROUTE_TO_STUDIO: Conversation = {
  actions: [
    {
      pick: 'map-main/showRoute',
      params: { destination: { value: 'Studio Vortex HQ' } },
    },
  ],
};

async function run(
  ids: readonly string[],
  variants: readonly string[],
  script: Conversation,
) {
  const transport = scriptedFetch(conversation(script));
  const module = actionsModuleWith({
    client: typesafeClientBuilder(
      typesafeSettings({
        apiKey: 'typesafe-test-key',
        model: TEST_MODEL,
        fetch: transport.fetch,
      }),
    ),
  });
  const records = (await runStageEval(module, {
    scenarios: selectScenarios('all', ids),
    variants,
    repeats: 1,
  })) as StageTurnRecord<ActionsTurnDetail>[];
  return { records, payloads: transport.calls };
}

describe('actions stage eval', () => {
  test('passes a plan whose Jev answers bind every expected value', async () => {
    for (const variant of ['stepwise', 'batched-per-instance']) {
      const { records } = await run(
        ['enum-route-short-name'],
        [variant],
        ROUTE_TO_STUDIO,
      );
      const [record] = records;
      expect(record.stage).toBe('jevActions');
      expect(record.outcome).toBe('pass');
      expect(record.failures).toEqual([]);
      expect(record.detail?.actions).toEqual([
        {
          instanceId: 'map-main',
          action: 'showRoute',
          params: { destination: 'Studio Vortex HQ' },
          pending: [],
        },
      ]);
      expect(record.detail?.repeated).toEqual([]);
      expect(record.detail?.unexpected).toEqual([]);
    }
  });

  test('counts a value left to the completion call as handed off, not a pass', async () => {
    const { records } = await run(['enum-route-short-name'], ['stepwise'], {
      actions: [
        {
          pick: 'map-main/showRoute',
          params: { destination: 'stated_elsewhere' },
        },
      ],
    });
    const [record] = records;
    expect(record.outcome).toBe('handed_off');
    expect(record.detail?.actions[0]?.pending).toEqual(['destination']);
  });

  test('fails and reports an action planned twice on one instance', async () => {
    const { records } = await run(['show-then-route'], ['stepwise'], {
      actions: [
        ...(ROUTE_TO_STUDIO.actions ?? []),
        ...(ROUTE_TO_STUDIO.actions ?? []),
      ],
    });
    const [record] = records;
    expect(record.outcome).toBe('fail');
    expect(record.detail?.repeated).toEqual(['map-main.showRoute']);
    expect(record.detail?.unexpected).toEqual([]);
    const section = renderRepeatedActionsSection(records, ['stepwise']);
    expect(section).toContain('| Turns repeating an action | 1/1 (100%) |');
    expect(section).toContain('| show-then-route | r 1/1, u 0/1 |');
  });

  test('reports an action the scenario does not expect', async () => {
    const { records } = await run(['enum-route'], ['stepwise'], {
      actions: [
        ...(ROUTE_TO_STUDIO.actions ?? []),
        { pick: 'weather-main/showHourly' },
      ],
    });
    const [record] = records;
    expect(record.outcome).toBe('fail');
    expect(record.detail?.unexpected).toEqual(['weather-main.showHourly']);
  });

  test('fails a listed value bound where none clearly matches, and passes leaving it open', async () => {
    const bound = await run(['enum-route-unlisted'], ['stepwise'], {
      actions: [
        {
          pick: 'map-main/showRoute',
          params: { destination: { value: 'Home' } },
        },
      ],
    });
    expect(bound.records[0]?.outcome).toBe('fail');
    expect(bound.records[0]?.failures).toEqual([
      'Bound map-main.showRoute.destination to "Home"',
    ]);
    for (const answer of ['stated_elsewhere', 'not_stated'] as const) {
      const open = await run(['enum-route-unlisted'], ['stepwise'], {
        actions: [
          { pick: 'map-main/showRoute', params: { destination: answer } },
        ],
      });
      expect(open.records[0]?.outcome).toBe('pass');
    }
  });

  test('gives the batched stage the gold needsActions gate, so a scenario without actions makes no call', async () => {
    const { records, payloads } = await run(
      ['swap', 'ns-weather-somewhere'],
      ['batched-per-instance'],
      {},
    );
    expect(records.map((record) => record.outcome)).toEqual([
      'pass',
      'not_applicable',
    ]);
    expect(records[1]?.reason).toBe('states no visible set');
    expect(payloads).toHaveLength(0);
  });
});
