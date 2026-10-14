import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { selectScenarios } from '../../core/scenarios.js';
import { registerStageEval } from '../../core/stage-eval.js';
import { jevArms } from './arms.js';
import { typesafeClientBuilder } from './client-builder.js';
import {
  DEFAULT_SPATIAL_RECORDS_ARM,
  loadRecordedSpatialSignal,
  recordedSpatialSignal,
} from './recorded-spatial.js';
import { layoutModuleWith } from './stages/layout.js';
import { typesafeSettings } from './typesafe-settings.js';

const ARM = 'jev-gated-per-instance-composed-pairs-inline';

const PACKAGE_ROOT = resolve(import.meta.dir, '../../..');

async function withRecords<T>(
  records: unknown,
  body: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'evals-spatial-'));
  try {
    const path = join(dir, 'records.json');
    await writeFile(path, JSON.stringify(records));
    return await body(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function liveRecord(
  arm: string,
  scenarioId: string,
  repeat: number,
  spatial?: { answer: string; probability: number; confidence: number },
) {
  return {
    arm,
    scenarioId,
    repeat,
    stageOutputs: {
      jevSelect: spatial ? { instances: [], gates: { spatial } } : undefined,
    },
  };
}

describe('recorded spatial signal', () => {
  test('keeps the spatial gate the named arm answered, per scenario and repeat', () => {
    const signal = recordedSpatialSignal(
      [
        liveRecord(ARM, 'swap', 1, {
          answer: 'no',
          probability: 0.47,
          confidence: 0.6,
        }),
        liveRecord(ARM, 'swap', 2, {
          answer: 'yes',
          probability: 0.52,
          confidence: 0.6,
        }),
        liveRecord('jev-poc', 'swap', 3, {
          answer: 'yes',
          probability: 0.9,
          confidence: 0.9,
        }),
        liveRecord(ARM, 'compare', 1),
      ],
      ARM,
    );
    expect(signal.lookup('swap', 1)).toEqual({
      answer: 'no',
      probability: 0.47,
      confidence: 0.6,
    });
    expect(signal.lookup('swap', 2)?.answer).toBe('yes');
    expect(signal.lookup('swap', 3)).toBeUndefined();
    expect(signal.lookup('compare', 1)).toBeUndefined();
    expect(signal.size).toBe(2);
  });

  test('reads the answer from the probability, as the gated select stage does', () => {
    const signal = recordedSpatialSignal(
      [
        liveRecord(ARM, 'swap', 1, {
          answer: 'maybe',
          probability: 0.5,
          confidence: 0.6,
        }),
      ],
      ARM,
    );
    expect(signal.lookup('swap', 1)?.answer).toBe('yes');
  });

  test('the default arm is a registered arm', () => {
    const names = jevArms(typesafeSettings()).map((arm) => arm.name);
    expect(names).toContain(DEFAULT_SPATIAL_RECORDS_ARM);
  });

  test('loading fails when the arm recorded no spatial gate', async () => {
    await withRecords(
      [
        liveRecord(ARM, 'swap', 1, {
          answer: 'yes',
          probability: 0.9,
          confidence: 0.9,
        }),
      ],
      async (path) => {
        await expect(
          loadRecordedSpatialSignal(path, 'jev-poc'),
        ).rejects.toThrow(
          `${path} holds no spatial gate recorded by arm jev-poc`,
        );
        expect((await loadRecordedSpatialSignal(path, ARM)).size).toBe(1);
      },
    );
  });

  test('the stage eval command line rejects an unknown --spatial-records-arm', async () => {
    const run = Bun.spawnSync(
      [
        process.execPath,
        '--conditions=@maelstrom-co/source',
        'src/eval-stages/cli.ts',
        '--stage',
        'layout',
        '--spatial-signal',
        'recorded-live',
        '--spatial-records',
        'records.json',
        '--spatial-records-arm',
        'nope',
      ],
      { cwd: PACKAGE_ROOT, env: { PATH: process.env.PATH ?? '' } },
    );
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toContain(
      `--spatial-records-arm: unknown arm nope; known arms: jev-poc, jev-poc-screen-scope, jev-composed-pairs-screen-scope, jev-ungated-stepwise-preset-inline,`,
    );
  }, 30_000);
});

describe('the layout stage eval spatial flags', () => {
  const layout = registerStageEval(
    layoutModuleWith({
      client: typesafeClientBuilder(typesafeSettings({ model: 'test-model' })),
    }),
  );
  const run = { scenarios: selectScenarios('all', ['swap']), repeats: 2 };
  const swapGate = { answer: 'yes', probability: 0.9, confidence: 0.9 };

  test('rejects --spatial-records and --spatial-records-arm without --spatial-signal recorded-live', async () => {
    for (const values of [
      { 'spatial-signal': 'gold', 'spatial-records': 'records.json' },
      {
        'spatial-signal': 'gold',
        'spatial-records-arm': DEFAULT_SPATIAL_RECORDS_ARM,
      },
    ])
      await expect(layout.configure(values, run)).rejects.toThrow(
        '--spatial-records and --spatial-records-arm need --spatial-signal recorded-live',
      );
  });

  test('fails when the arm recorded no spatial gate for the selected turns', async () => {
    await withRecords(
      [liveRecord(DEFAULT_SPATIAL_RECORDS_ARM, 'compare', 1, swapGate)],
      async (path) => {
        await expect(
          layout.configure(
            {
              'spatial-signal': 'recorded-live',
              'spatial-records': path,
              'spatial-records-arm': DEFAULT_SPATIAL_RECORDS_ARM,
            },
            run,
          ),
        ).rejects.toThrow(
          `${path} holds no spatial gate recorded by arm ${DEFAULT_SPATIAL_RECORDS_ARM} for the selected 1 scenarios x 2 repeats`,
        );
      },
    );
  });

  test('counts the selected turns the arm recorded a spatial gate for', async () => {
    await withRecords(
      [liveRecord(DEFAULT_SPATIAL_RECORDS_ARM, 'swap', 2, swapGate)],
      async (path) => {
        const configured = await layout.configure(
          {
            'spatial-signal': 'recorded-live',
            'spatial-records': path,
            'spatial-records-arm': DEFAULT_SPATIAL_RECORDS_ARM,
          },
          run,
        );
        expect(configured.meta.spatialSignalRecordedTurns).toBe(
          '1 of 2 scenario turns',
        );
      },
    );
  });
});
