import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deferred, pipeline, type Stage } from '@maelstrom-co/engine';
import { err, isErr, isOk, ok } from '@maelstrom-co/protocol';

import {
  makeContext,
  makeInput,
  makeRequest,
} from '../src/lib/__test-helpers__/fixtures.js';
import { createRecorder, type StageRecord } from './instrument.js';
import {
  loadReplay,
  replayedStages,
  replayStage,
  verifyReplay,
  verifyReplayShape,
  writeStageFile,
} from './replay.js';
import { type Scenario, selectScenarios } from './scenarios.js';

const input = makeInput(makeRequest('hide the weather'));
const ctx = makeContext(input);

const recorded: StageRecord[] = [
  { stage: 'jevSelect', ms: 5, outcome: 'ok', output: { picked: 'select' } },
  {
    stage: 'jevActions',
    ms: 7,
    outcome: 'deferred',
    reason: 'jevActions/action_unsupported',
  },
];

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

describe('replayStage', () => {
  const cache = { key: 'swap #1', stages: recorded };

  test('returns the recorded output without running anything', async () => {
    const result = await replayStage('jevSelect', cache)(input, ctx);
    expect(isOk(result) && result.value).toEqual({ picked: 'select' });
  });

  test('replays a recorded deferral as the same deferral', async () => {
    const result = await replayStage('jevActions', cache)(input, ctx);
    expect(isErr(result) && result.error).toEqual(
      deferred('jevActions/action_unsupported'),
    );
  });

  test('throws naming the stage and turn when nothing was recorded', async () => {
    await expect(replayStage('jevLayout', cache)(input, ctx)).rejects.toThrow(
      'replay: no recorded jevLayout for swap #1',
    );
    await expect(
      replayStage('jevSelect', { key: 'gone #2' })(input, ctx),
    ).rejects.toThrow('replay: no recorded jevSelect for gone #2');
  });

  test('a downstream stage runs live on the replayed output', async () => {
    const recorder = createRecorder({
      jevSelect: replayStage('jevSelect', cache),
    });
    let liveSelectRan = false;
    const liveSelect: Stage<unknown, unknown> = async () => {
      liveSelectRan = true;
      return ok('live');
    };
    const seen: unknown[] = [];
    const liveActions: Stage<unknown, never> = async (value) => {
      seen.push(value);
      return err(deferred('jevActions/action_limit'));
    };
    await pipeline(
      recorder.instrument('jevSelect', liveSelect),
      recorder.instrument('jevActions', liveActions),
    )(input, ctx);
    expect(liveSelectRan).toBe(false);
    expect(seen).toEqual([{ picked: 'select' }]);
    expect(recorder.stages).toMatchObject([
      { stage: 'jevSelect', outcome: 'ok', replayed: true, input },
      {
        stage: 'jevActions',
        outcome: 'deferred',
        input: { picked: 'select' },
      },
    ]);
    expect(recorder.stages[1]?.replayed).toBe(undefined);
  });
});

describe('replay files', () => {
  test('round-trip through <out>/stages/<arm>/<scenarioId>-<repeat>.json', async () => {
    const out = await mkdtemp(join(tmpdir(), 'planner-jev-replay-'));
    dirs.push(out);
    const path = await writeStageFile(out, {
      arm: 'jev-poc',
      scenarioId: 'se-landmark',
      repeat: 2,
      stages: recorded,
    });
    expect(path).toBe(join(out, 'stages', 'jev-poc', 'se-landmark-2.json'));
    const source = await loadReplay(out, 'jev-poc');
    expect(source.turn('se-landmark', 2)).toEqual({
      key: 'se-landmark #2',
      stages: recorded,
    });
    expect(source.turn('se-landmark', 1).stages).toBe(undefined);
  });

  test('a missing source directory is a clear error', async () => {
    const out = await mkdtemp(join(tmpdir(), 'planner-jev-replay-'));
    dirs.push(out);
    await expect(loadReplay(out, 'jev-poc')).rejects.toThrow(
      `replay: no recorded stages in ${join(out, 'stages', 'jev-poc')}`,
    );
  });

  test('a directory that cannot be read is surfaced, not taken for an empty run', async () => {
    const out = await mkdtemp(join(tmpdir(), 'planner-jev-replay-'));
    dirs.push(out);
    await mkdir(join(out, 'stages'), { recursive: true });
    await writeFile(join(out, 'stages', 'jev-poc'), 'not a directory');
    await expect(loadReplay(out, 'jev-poc')).rejects.toThrow(
      `replay: cannot read ${join(out, 'stages', 'jev-poc')}`,
    );
  });

  test('a stage file that is not JSON is named', async () => {
    const out = await mkdtemp(join(tmpdir(), 'planner-jev-replay-'));
    dirs.push(out);
    const dir = join(out, 'stages', 'jev-poc');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'swap-1.json'), '{ truncated');
    await expect(loadReplay(out, 'jev-poc')).rejects.toThrow(
      `replay: cannot read ${join(dir, 'swap-1.json')}`,
    );
  });

  test('--replay-through names every stage up to and including it', () => {
    expect(replayedStages('select')).toEqual(['jevSelect']);
    expect(replayedStages('actions')).toEqual(['jevSelect', 'jevActions']);
    expect(replayedStages('layout')).toEqual([
      'jevSelect',
      'jevActions',
      'jevLayout',
    ]);
  });
});

describe('verifyReplay', () => {
  const [swap] = selectScenarios('development', ['swap']) as [Scenario];

  async function recordedRun(repeats: readonly number[]) {
    const out = await mkdtemp(join(tmpdir(), 'planner-jev-replay-'));
    dirs.push(out);
    for (const repeat of repeats)
      await writeStageFile(out, {
        arm: 'jev-poc',
        scenarioId: swap.id,
        repeat,
        stages: [
          {
            stage: 'jevSelect',
            ms: 5,
            outcome: 'ok',
            input: {
              messageId: `swap-jev-poc-${repeat}`,
              sessionId: 'eval-jev-poc',
              request: swap.request,
              history: swap.history ?? [],
            },
            output: { picked: 'select' },
          },
        ],
      });
    return loadReplay(out, 'jev-poc');
  }

  test('passes a recording of the same scenarios, whichever arm recorded it', async () => {
    const source = await recordedRun([1, 2]);
    expect(() => verifyReplay(source, [swap], 2)).not.toThrow();
  });

  test('names the replay dir and every turn whose request or history changed', async () => {
    const source = await recordedRun([1]);
    const edited: Scenario = {
      ...swap,
      request: { ...swap.request, instances: [] },
      history: [{ role: 'user', content: 'earlier' }],
    };
    expect(() => verifyReplay(source, [edited], 1)).toThrow(source.dir);
    expect(() => verifyReplay(source, [edited], 1)).toThrow(
      'swap #1: request differs',
    );
    expect(() => verifyReplay(source, [edited], 1)).toThrow(
      'swap #1: history differs',
    );
  });

  test('refuses a recording that lacks a selected scenario or repeat', async () => {
    const source = await recordedRun([1]);
    const [ambiguous] = selectScenarios('development', ['ambiguous']);
    expect(() =>
      verifyReplay(source, [swap, ambiguous as Scenario], 2),
    ).toThrow(/swap #2: no recorded turn[\s\S]*ambiguous #1: no recorded turn/);
  });
});

describe('verifyReplayShape', () => {
  const [swap] = selectScenarios('development', ['swap']) as [Scenario];
  const gate = { answer: 'no', probability: 0.1, confidence: 0.8 };
  const gates = { needsActions: gate, generatedContent: gate, spatial: gate };
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
  const check =
    (
      stages: readonly StageRecord[],
      through: 'select' | 'actions',
      replayShape: 'poc' | 'ungated' | 'gated',
    ) =>
    () =>
      verifyReplayShape(sourceOf(stages), [swap], 2, replayedStages(through), [
        { name: 'arm', replayShape },
      ]);

  test('lets the POC replay any recording', () => {
    expect(check(pocTurn, 'actions', 'poc')).not.toThrow();
    expect(check(gatedTurn, 'actions', 'poc')).not.toThrow();
  });

  test('refuses a gated arm a selection or action plan without gates', () => {
    expect(check(pocTurn, 'select', 'gated')).toThrow(
      'replay: the recording in /recorded lacks what these arms read:\n- arm: jevSelect has no complete gates (2 turns: swap #1, swap #2)',
    );
    expect(check(gatedTurn, 'actions', 'gated')).not.toThrow();
  });

  test('refuses a stage-library arm an action plan without minConfidence', () => {
    expect(check(pocTurn, 'select', 'ungated')).not.toThrow();
    expect(check(pocTurn, 'actions', 'ungated')).toThrow(
      '- arm: jevActions has no minConfidence',
    );
  });

  test('refuses an ungated arm a recording that carries gates', () => {
    expect(check(gatedTurn, 'select', 'ungated')).toThrow(
      '- arm: jevSelect carries gates this ungated arm would act on',
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
