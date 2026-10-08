import { describe, expect, test } from 'bun:test';
import type { Ask } from '@maelstrom-co/planner-jev/_internal';
import {
  conversation,
  type Script,
  scriptedFetch,
  TEST_MODEL,
} from '@maelstrom-co/planner-jev/_testing';
import { isOk, ok } from '@maelstrom-co/protocol';
import { type Scenario, selectScenarios } from '../../../core/scenarios.js';
import {
  runStageEval,
  type StageTurnRecord,
} from '../../../core/stage-eval.js';
import { typesafeClientBuilder } from '../client-builder.js';
import { typesafeSettings } from '../typesafe-settings.js';
import {
  renderGateErrorsSection,
  renderSelectionSection,
  type SelectModule,
  type SelectTurnDetail,
  selectModuleWith,
} from './select.js';

const QUIET_GATES = {
  'gate/needsActions': 0.1,
  'gate/generatedContent': 0.1,
  'gate/spatial': 0.9,
};

const SWAP_SELECTION = {
  'view/map-main': 'keep',
  'view/weather-main': 'hide',
  'view/tasks-main': 'hide',
};

async function run(
  ids: readonly string[],
  script: Script,
  droppedAnswer?: string,
) {
  return runOn(selectScenarios('all', ids), script, droppedAnswer);
}

async function runOn(
  scenarios: readonly Scenario[],
  script: Script,
  droppedAnswer?: string,
) {
  const transport = scriptedFetch(script);
  const scripted = selectModuleWith({
    client: typesafeClientBuilder(
      typesafeSettings({
        apiKey: 'typesafe-test-key',
        model: TEST_MODEL,
        fetch: transport.fetch,
      }),
    ),
  });
  const module: SelectModule =
    droppedAnswer === undefined
      ? scripted
      : {
          ...scripted,
          makeDeps: (onCall) => {
            const { ask } = scripted.makeDeps(onCall);
            return { ask: withoutAnswer(ask, droppedAnswer) };
          },
        };
  const records = (await runStageEval(module, {
    scenarios,
    variants: ['gated'],
    repeats: 1,
  })) as StageTurnRecord<SelectTurnDetail>[];
  return { records, payloads: transport.calls };
}

function withoutAnswer(ask: Ask, id: string): Ask {
  return async (stage, evaluation, ctx) => {
    const result = await ask(stage, evaluation, ctx);
    if (!isOk(result)) return result;
    const { [id]: _, ...answers } = result.value.answers;
    return ok({ ...result.value, answers });
  };
}

describe('select stage eval', () => {
  test('fails only the gate that answered wrong, naming its probability', async () => {
    const { records, payloads } = await run(
      ['swap'],
      conversation({
        select: SWAP_SELECTION,
        gates: { ...QUIET_GATES, 'gate/needsActions': 0.9 },
      }),
    );
    const [record] = records;
    expect(payloads).toHaveLength(1);
    expect(record?.stage).toBe('jevSelect');
    expect(record?.outcome).toBe('fail');
    expect(record?.failures).toEqual([
      'needsActions: expected no, answered yes (p=0.90)',
    ]);
    expect(record?.detail?.expected).toEqual({
      needsActions: 'no',
      generatedContent: 'no',
      spatial: 'yes',
      dependsOnScreen: 'no',
    });
    expect(record?.detail?.gates.needsActions).toMatchObject({
      answer: 'yes',
      probability: 0.9,
    });
  });

  test('fails a turn whose selection hides an instance the scenario keeps visible', async () => {
    const { records } = await run(
      ['show-hidden'],
      conversation({
        select: { 'view/map-main': 'keep', 'view/weather-main': 'hide' },
        gates: { ...QUIET_GATES, 'gate/spatial': 0.1 },
      }),
    );
    const [record] = records;
    expect(record?.outcome).toBe('fail');
    expect(record?.failures).toEqual([
      'Selected visible: expected ["calendar-main","map-main","tasks-main","weather-main"], received ["calendar-main","map-main","tasks-main"]',
    ]);
    expect(record?.detail?.selection).toEqual({
      expectedVisible: [
        'calendar-main',
        'map-main',
        'tasks-main',
        'weather-main',
      ],
      visible: ['calendar-main', 'map-main', 'tasks-main'],
      pass: false,
    });
  });

  test('records the selected visible instances of a turn whose selection matches', async () => {
    const { records } = await run(
      ['show-hidden'],
      conversation({
        select: { 'view/map-main': 'keep' },
        gates: { ...QUIET_GATES, 'gate/spatial': 0.1 },
      }),
    );
    const [record] = records;
    expect(record?.outcome).toBe('pass');
    expect(record?.detail?.selection).toEqual({
      expectedVisible: [
        'calendar-main',
        'map-main',
        'tasks-main',
        'weather-main',
      ],
      visible: ['calendar-main', 'map-main', 'tasks-main', 'weather-main'],
      pass: true,
    });
  });

  test('reports selection accuracy per variant, and every wrong visible set', async () => {
    const wrong = await run(
      ['show-hidden'],
      conversation({
        select: { 'view/map-main': 'keep', 'view/weather-main': 'hide' },
        gates: { ...QUIET_GATES, 'gate/spatial': 0.1 },
      }),
    );
    const right = await run(
      ['swap'],
      conversation({ select: SWAP_SELECTION, gates: QUIET_GATES }),
    );
    const deferred = await run(
      ['swap'],
      conversation({ select: { scope: 'ambiguous' }, gates: QUIET_GATES }),
    );
    const section = renderSelectionSection(
      [...wrong.records, ...right.records, ...deferred.records],
      ['gated'],
    );
    expect(section).toContain('| gated | 3 | 1 | 1 | 1 |');
    expect(section).toContain(
      '| show-hidden | development | gated | 1 | calendar-main, map-main, tasks-main, weather-main | calendar-main, map-main, tasks-main |',
    );
    expect(section).toContain(
      '| swap | development | gated | 1 | calendar-main, map-main | deferred jevSelect/scope_ambiguous |',
    );
  });

  test('passes when every expected gate matches', async () => {
    const { records } = await run(
      ['swap'],
      conversation({ select: SWAP_SELECTION, gates: QUIET_GATES }),
    );
    expect(records[0]?.outcome).toBe('pass');
    expect(records[0]?.detail?.deferral).toBeUndefined();
  });

  test('judges the gates of a turn the stage deferred, recording the deferral', async () => {
    const { records } = await run(
      ['swap'],
      conversation({
        gates: { ...QUIET_GATES, 'gate/generatedContent': 0.9 },
      }),
    );
    const [record] = records;
    expect(record?.outcome).toBe('fail');
    expect(record?.failures).toEqual([
      'generatedContent: expected no, answered yes (p=0.90)',
      'Selected visible: no selection, the stage deferred jevSelect/scope_unsupported',
    ]);
    expect(record?.detail?.deferral).toBe('jevSelect/scope_unsupported');
    expect(Object.keys(record?.detail?.gates ?? {})).toEqual([
      'needsActions',
      'generatedContent',
      'spatial',
      'dependsOnScreen',
    ]);
  });

  test('judges the gates of a turn the stage deferred for screen content, recording the deferral', async () => {
    const { records } = await run(
      ['swap'],
      conversation({
        gates: { ...QUIET_GATES, 'gate/dependsOnScreen': 0.9 },
      }),
    );
    const [record] = records;
    expect(record?.outcome).toBe('fail');
    expect(record?.failures).toEqual([
      'dependsOnScreen: expected no, answered yes (p=0.90)',
      'Selected visible: no selection, the stage deferred jevSelect/screen_content_unavailable',
    ]);
    expect(record?.detail?.deferral).toBe(
      'jevSelect/screen_content_unavailable',
    );
    expect(Object.keys(record?.detail?.gates ?? {})).toEqual([
      'needsActions',
      'generatedContent',
      'spatial',
      'dependsOnScreen',
    ]);
  });

  test('is not applicable to a scenario with no expected answer for any gate', async () => {
    const { records, payloads } = await run(
      ['ambiguous'],
      conversation({ gates: QUIET_GATES }),
    );
    expect(records.map((record) => record.outcome)).toEqual(['not_applicable']);
    expect(payloads).toEqual([]);
  });

  test('ignores an expected gate the planner does not ask', async () => {
    const [journal] = selectScenarios('all', [
      'journal-key-points-of-todays-plan',
    ]);
    if (journal === undefined) throw new Error('scenario missing');
    const withUnaskedGate: Scenario = {
      ...journal,
      expected: {
        ...journal.expected,
        expectedGates: { ...journal.expected.expectedGates, unasked: 'yes' },
      },
    };
    const { records } = await runOn(
      [withUnaskedGate],
      conversation({
        gates: {
          ...QUIET_GATES,
          'gate/spatial': 0.1,
          'gate/dependsOnScreen': 0.9,
        },
      }),
    );
    const [record] = records;
    expect(record?.outcome).toBe('pass');
    expect(record?.detail?.expected).toEqual({
      generatedContent: 'no',
      dependsOnScreen: 'yes',
    });
  });

  test('records a provider failure as an error, not a deferral', async () => {
    const { records } = await run(['swap'], () => ({ status: 500 }));
    expect(records[0]?.outcome).toBe('error');
    expect(records[0]?.reason).toBe('ProviderError: jevSelect/provider_http');
    expect(records[0]?.detail).toBeUndefined();
  });

  test('records a reply missing a gate answer as an error', async () => {
    const { records } = await run(
      ['swap'],
      conversation({ gates: QUIET_GATES }),
      'gate/spatial',
    );
    expect(records[0]?.outcome).toBe('error');
    expect(records[0]?.reason).toBe('ParseError: jevSelect/answer_missing');
  });

  test('judges the gates of a turn the selection deferred before any gate was read', async () => {
    const { records } = await run(
      ['swap'],
      conversation({ select: { scope: 'ambiguous' }, gates: QUIET_GATES }),
    );
    const [record] = records;
    expect(record?.outcome).toBe('fail');
    expect(record?.failures).toEqual([
      'Selected visible: no selection, the stage deferred jevSelect/scope_ambiguous',
    ]);
    expect(record?.detail?.deferral).toBe('jevSelect/scope_ambiguous');
    expect(Object.keys(record?.detail?.gates ?? {})).toEqual([
      'needsActions',
      'generatedContent',
      'spatial',
      'dependsOnScreen',
    ]);
  });

  test('keeps the selection deferral when its reply lacks a gate answer', async () => {
    const { records } = await run(
      ['swap'],
      conversation({ select: { scope: 'ambiguous' }, gates: QUIET_GATES }),
      'gate/spatial',
    );
    expect(records[0]?.outcome).toBe('deferred');
    expect(records[0]?.reason).toBe('jevSelect/scope_ambiguous');
    expect(records[0]?.detail).toBeUndefined();
  });

  test('lists the misses of one gate by rising probability', async () => {
    const high = await run(
      ['swap'],
      conversation({
        select: SWAP_SELECTION,
        gates: { ...QUIET_GATES, 'gate/needsActions': 0.9 },
      }),
    );
    const low = await run(
      ['swap'],
      conversation({
        select: SWAP_SELECTION,
        gates: { ...QUIET_GATES, 'gate/needsActions': 0.6 },
      }),
    );
    const section = renderGateErrorsSection(
      [...high.records, ...low.records],
      ['gated'],
    );
    const lowRow = section.indexOf('| needsActions | no | 0.60 |');
    const highRow = section.indexOf('| needsActions | no | 0.90 |');
    expect(lowRow).toBeGreaterThan(-1);
    expect(highRow).toBeGreaterThan(lowRow);
  });

  test('reports false positives and negatives per gate, and every miss', async () => {
    const wrong = await run(
      ['swap'],
      conversation({
        gates: {
          'gate/needsActions': 0.8,
          'gate/generatedContent': 0.1,
          'gate/spatial': 0.3,
        },
      }),
    );
    const right = await run(
      ['enum-route'],
      conversation({
        gates: { ...QUIET_GATES, 'gate/needsActions': 0.9 },
      }),
    );
    const section = renderGateErrorsSection(
      [...wrong.records, ...right.records],
      ['gated'],
    );
    expect(section).toContain('| gated | needsActions | 2 | 1 | 0 |');
    expect(section).toContain('| gated | generatedContent | 2 | 0 | 0 |');
    expect(section).toContain('| gated | spatial | 1 | 0 | 1 |');
    expect(section).toContain(
      '| swap | development | gated | 1 | needsActions | no | 0.80 |',
    );
    expect(section).toContain(
      '| swap | development | gated | 1 | spatial | yes | 0.30 |',
    );
  });
});
