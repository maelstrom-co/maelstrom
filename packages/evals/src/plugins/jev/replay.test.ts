import { describe, expect, test } from 'bun:test';

import type { StageRecord } from '../../core/instrument.js';
import { replayedStages, verifyReplayShape } from '../../core/replay.js';
import { type Scenario, selectScenarios } from '../../core/scenarios.js';
import type { ReplayShape } from './arms.js';
import { jevPlugin } from './plugin.js';

describe('replay into the Jev arms', () => {
  const [swap] = selectScenarios('development', ['swap']) as [Scenario];
  const gate = { answer: 'no', probability: 0.1, confidence: 0.8 };
  const gates = {
    needsActions: gate,
    generatedContent: gate,
    spatial: gate,
    dependsOnScreen: gate,
  };
  const pocTurn: StageRecord[] = [
    { stage: 'jevSelect', ms: 1, outcome: 'ok', output: { instances: [] } },
    { stage: 'jevActions', ms: 1, outcome: 'ok', output: { actions: [] } },
  ];
  const gatedTurn: StageRecord[] = [
    { stage: 'jevSelect', ms: 1, outcome: 'ok', output: { gates } },
    {
      stage: 'jevActions',
      ms: 1,
      outcome: 'ok',
      output: { gates, minConfidence: 0.8 },
    },
  ];
  const sourceOf = (stages: readonly StageRecord[]) => ({
    dir: '/recorded',
    turn: (scenarioId: string, repeat: number) => ({
      key: `${scenarioId} #${repeat}`,
      stages,
    }),
  });
  const ARM_OF: Record<ReplayShape, string> = {
    poc: 'jev-poc',
    ungated: 'jev-ungated-stepwise-preset-inline',
    gated: 'jev-gated-batched-preset-inline',
  };
  const check =
    (
      stages: readonly StageRecord[],
      through: 'select' | 'actions',
      shape: ReplayShape,
    ) =>
    () => {
      const arm = jevPlugin.arms.find(
        (candidate) => candidate.name === ARM_OF[shape],
      );
      if (!arm) throw new Error(`no arm of shape ${shape}`);
      verifyReplayShape(sourceOf(stages), [swap], 2, through, [
        { arm, plugin: jevPlugin },
      ]);
    };

  test('--replay-through maps a phase to the Jev stages up to it', () => {
    expect(replayedStages(jevPlugin, 'select')).toEqual(['jevSelect']);
    expect(replayedStages(jevPlugin, 'actions')).toEqual([
      'jevSelect',
      'jevActions',
    ]);
    expect(replayedStages(jevPlugin, 'layout')).toEqual([
      'jevSelect',
      'jevActions',
      'jevLayout',
    ]);
    expect(() => replayedStages(jevPlugin, 'complete')).toThrow(
      'replay: jev has no complete phase; its phases are select, actions, layout',
    );
  });

  test('lets the POC replay any recording', () => {
    expect(check(pocTurn, 'actions', 'poc')).not.toThrow();
    expect(check(gatedTurn, 'actions', 'poc')).not.toThrow();
  });

  test('refuses a gated arm a selection or action plan without gates', () => {
    expect(check(pocTurn, 'select', 'gated')).toThrow(
      'replay: the recording in /recorded lacks what these arms read:\n- jev-gated-batched-preset-inline: jevSelect has no complete gates (2 turns: swap #1, swap #2)',
    );
    expect(check(gatedTurn, 'actions', 'gated')).not.toThrow();
  });

  test('refuses a stage-library arm an action plan without minConfidence', () => {
    expect(check(pocTurn, 'select', 'ungated')).not.toThrow();
    expect(check(pocTurn, 'actions', 'ungated')).toThrow(
      '- jev-ungated-stepwise-preset-inline: jevActions has no minConfidence',
    );
  });

  test('refuses an ungated arm a recording that carries gates', () => {
    expect(check(gatedTurn, 'select', 'ungated')).toThrow(
      '- jev-ungated-stepwise-preset-inline: jevSelect carries gates this ungated arm would act on',
    );
  });

  test('checks only replayed stages that completed', () => {
    const deferredActions: StageRecord[] = [
      gatedTurn[0] as StageRecord,
      {
        stage: 'jevActions',
        ms: 1,
        outcome: 'deferred',
        reason: 'jevActions/action_limit',
      },
    ];
    expect(check(deferredActions, 'actions', 'gated')).not.toThrow();
    expect(
      check(
        pocTurn.slice(0, 1).concat(gatedTurn[1] as StageRecord),
        'select',
        'ungated',
      ),
    ).not.toThrow();
  });
});
