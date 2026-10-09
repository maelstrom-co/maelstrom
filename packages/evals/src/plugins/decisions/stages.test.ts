import { describe, expect, test } from 'bun:test';
import type { AskCall } from '@maelstrom-co/planner-jev/_internal';
import {
  conversation,
  DECISIONS_TEST_MODEL,
  type DecisionsScript,
  type Script,
  scriptedDecisionsFetch,
} from '@maelstrom-co/planner-jev/_testing';
import { selectScenarios } from '../../core/scenarios.js';
import { runStageEval, type StageTurnRecord } from '../../core/stage-eval.js';
import {
  type ActionsTurnDetail,
  actionsModuleWith,
} from '../jev/stages/actions.js';
import {
  type LayoutTurnDetail,
  layoutModuleWith,
} from '../jev/stages/layout.js';
import {
  type SelectTurnDetail,
  selectModuleWith,
} from '../jev/stages/select.js';
import { decisionsClientBuilder } from './client-builder.js';
import { decisionsSettings } from './decisions-settings.js';
import { decisionsPluginWith } from './plugin.js';

function scripted(script: DecisionsScript | Script) {
  const transport = scriptedDecisionsFetch(script);
  const client = decisionsClientBuilder(
    decisionsSettings({
      apiKey: 'decisions-test-key',
      model: DECISIONS_TEST_MODEL,
      fetch: transport.fetch,
    }),
  );
  return { client, transport };
}

/** The Decisions calls of a turn, with the state each one sent. */
function callsOf(record: StageTurnRecord<unknown>) {
  return record.calls as readonly (AskCall & { readonly state?: unknown })[];
}

describe('the Decisions stage evals on the scripted Decisions transport', () => {
  test('decisions-select judges the gates Decisions answered', async () => {
    const { client, transport } = scripted(
      conversation({
        select: {
          'view/map-main': 'keep',
          'view/weather-main': 'hide',
          'view/tasks-main': 'hide',
        },
        gates: {
          'gate/needsActions': 0.9,
          'gate/generatedContent': 0.1,
          'gate/spatial': 0.9,
        },
      }),
    );
    const module = selectModuleWith({ client, name: 'decisions-select' });
    expect(module).toMatchObject({
      name: 'decisions-select',
      provider: 'Decisions',
    });
    const [record] = (await runStageEval(module, {
      scenarios: selectScenarios('all', ['swap']),
      variants: ['gated'],
      repeats: 1,
    })) as StageTurnRecord<SelectTurnDetail>[];
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.input).toStartWith('{');
    expect(record?.stage).toBe('jevSelect');
    expect(record?.outcome).toBe('fail');
    expect(record?.failures).toEqual([
      'needsActions: expected no, answered yes (p=0.90)',
    ]);
    expect(callsOf(record as StageTurnRecord<unknown>)).toHaveLength(1);
    expect(callsOf(record as StageTurnRecord<unknown>)[0]).toMatchObject({
      stage: 'jevSelect',
      outcome: 'ok',
      state: expect.any(Object),
    });
  });

  test('decisions-select-prose sends the select state as prose and judges the selection', async () => {
    const transport = scriptedDecisionsFetch(
      conversation({
        select: { 'view/map-main': 'keep' },
        gates: {
          'gate/needsActions': 0.1,
          'gate/generatedContent': 0.1,
          'gate/spatial': 0.1,
        },
      }),
    );
    const module = decisionsPluginWith({
      decisions: {
        apiKey: 'decisions-test-key',
        model: DECISIONS_TEST_MODEL,
        fetch: transport.fetch,
      },
    }).stageModules?.find((stage) => stage.name === 'decisions-select-prose');
    if (module === undefined) throw new Error('no decisions-select-prose');
    const [record] = (await module.run({
      scenarios: selectScenarios('all', ['show-hidden']),
      variants: ['gated'],
      repeats: 1,
    })) as StageTurnRecord<SelectTurnDetail>[];
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.input).toStartWith(
      'The user\'s latest request: "Show the map next to the current widgets."',
    );
    expect(record?.outcome).toBe('pass');
    expect(record?.detail?.selection?.pass).toBe(true);
  });

  test('decisions-actions passes a plan whose Decisions answers bind every expected value', async () => {
    for (const variant of ['stepwise', 'batched-per-instance']) {
      const { client } = scripted(
        conversation({
          actions: [
            {
              pick: 'map-main/showRoute',
              params: { destination: { value: 'Studio Vortex HQ' } },
            },
          ],
        }),
      );
      const module = actionsModuleWith({ client, name: 'decisions-actions' });
      const [record] = (await runStageEval(module, {
        scenarios: selectScenarios('all', ['enum-route-short-name']),
        variants: [variant],
        repeats: 1,
      })) as StageTurnRecord<ActionsTurnDetail>[];
      expect(record?.stage).toBe('jevActions');
      expect(record?.outcome).toBe('pass');
      expect(record?.detail?.actions).toEqual([
        {
          instanceId: 'map-main',
          action: 'showRoute',
          params: { destination: 'Studio Vortex HQ' },
          pending: [],
        },
      ]);
      const calls = callsOf(record as StageTurnRecord<unknown>);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call.state).toBeDefined();
    }
  });

  test('decisions-layout calls the stage directly on gold inputs, with one Decisions call', async () => {
    const { client, transport } = scripted((payload) => ({
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
    }));
    const module = layoutModuleWith({ client, name: 'decisions-layout' });
    const [record] = (await runStageEval(module, {
      scenarios: selectScenarios('all', ['swap']),
      variants: ['composed-pairs'],
      repeats: 1,
    })) as StageTurnRecord<LayoutTurnDetail>[];
    expect(record?.outcome).toBe('pass');
    expect(record?.stage).toBe('jevLayout');
    expect(transport.requests).toHaveLength(1);
    const calls = callsOf(record as StageTurnRecord<unknown>);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.answers?.['pair/calendar-main/map-main']?.choice).toBe(
      'right_of',
    );
    expect(calls[0]?.state).toMatchObject({
      currentArrangement: expect.any(String),
    });
    expect(record?.detail?.tree).toEqual([
      'V',
      'ID:map-main',
      'ID:calendar-main',
    ]);
  });
  test('decisions-select reports a refusal as a provider error, layout and actions as a deferral', async () => {
    const refuseFirst: DecisionsScript = (payload) => ({
      refuse: Object.keys(payload.questions).slice(0, 1),
    });
    const options = (scenario: string, variant: string) => ({
      scenarios: selectScenarios('all', [scenario]),
      variants: [variant],
      repeats: 1,
    });
    const [select] = await runStageEval(
      selectModuleWith({
        client: scripted(refuseFirst).client,
        name: 'decisions-select',
      }),
      options('swap', 'gated'),
    );
    const [actions] = await runStageEval(
      actionsModuleWith({
        client: scripted(refuseFirst).client,
        name: 'decisions-actions',
      }),
      options('enum-route-short-name', 'stepwise'),
    );
    const [layout] = await runStageEval(
      layoutModuleWith({
        client: scripted(refuseFirst).client,
        name: 'decisions-layout',
      }),
      options('swap', 'composed-pairs'),
    );
    expect(select).toMatchObject({
      outcome: 'error',
      reason: 'ProviderError: jevSelect/provider_refusal',
    });
    expect(actions).toMatchObject({
      outcome: 'deferred',
      reason: 'jevActions/provider_refusal',
    });
    expect(layout).toMatchObject({
      outcome: 'deferred',
      reason: 'jevLayout/provider_refusal',
    });
    for (const record of [select, actions, layout])
      expect(record?.calls.map((call) => call.outcome)).toEqual([
        'provider_refusal',
      ]);
  });
});
