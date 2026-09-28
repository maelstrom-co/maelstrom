import { describe, expect, test } from 'bun:test';
import {
  conversation,
  type Script,
  scriptedFetch,
  TEST_MODEL,
} from '@maelstrom-co/planner-jev/_testing';
import { selectScenarios } from '../../../core/scenarios.js';
import {
  runStageEval,
  type StageTurnRecord,
} from '../../../core/stage-eval.js';
import { typesafeSettings } from '../typesafe-settings.js';
import {
  renderGateErrorsSection,
  type SelectTurnDetail,
  selectModuleWith,
} from './select.js';

const QUIET_GATES = {
  'gate/needsActions': 0.1,
  'gate/generatedContent': 0.1,
  'gate/spatial': 0.9,
};

async function run(ids: readonly string[], script: Script) {
  const transport = scriptedFetch(script);
  const module = selectModuleWith({
    typesafe: typesafeSettings({
      apiKey: 'typesafe-test-key',
      model: TEST_MODEL,
      fetch: transport.fetch,
    }),
  });
  const records = (await runStageEval(module, {
    scenarios: selectScenarios('all', ids),
    variants: ['gated'],
    repeats: 1,
  })) as StageTurnRecord<SelectTurnDetail>[];
  return { records, payloads: transport.calls };
}

describe('select stage eval', () => {
  test('fails only the gate that answered wrong, naming its probability', async () => {
    const { records, payloads } = await run(
      ['swap'],
      conversation({
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
    });
    expect(record?.detail?.gates.needsActions).toMatchObject({
      answer: 'yes',
      probability: 0.9,
    });
  });

  test('passes when every expected gate matches', async () => {
    const { records } = await run(
      ['swap'],
      conversation({ gates: QUIET_GATES }),
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
    ]);
    expect(record?.detail?.deferral).toBe('jevSelect/scope_unsupported');
    expect(Object.keys(record?.detail?.gates ?? {})).toEqual([
      'needsActions',
      'generatedContent',
      'spatial',
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
    const { records } = await run(
      ['journal-key-points-of-todays-plan'],
      conversation({ gates: { ...QUIET_GATES, 'gate/spatial': 0.1 } }),
    );
    const [record] = records;
    expect(record?.outcome).toBe('pass');
    expect(record?.detail?.expected).toEqual({ generatedContent: 'no' });
  });

  test('records a provider failure as the deferral it is, not a judged turn', async () => {
    const { records } = await run(['swap'], () => ({ status: 500 }));
    expect(records[0]?.outcome).toBe('deferred');
    expect(records[0]?.reason).toBe('jevSelect/provider_http');
    expect(records[0]?.detail).toBeUndefined();
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
