import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { arms } from '../eval/arms.js';
import {
  DEFAULT_SPATIAL_RECORDS_ARM,
  loadRecordedSpatialSignal,
  recordedSpatialSignal,
} from './recorded-spatial.js';

const ARM = 'jev-gated-per-instance-composed-pairs-inline';

const PACKAGE_ROOT = resolve(import.meta.dir, '../..');

async function withRecords<T>(
  records: unknown,
  body: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'planner-eval-spatial-'));
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
    expect(Object.keys(arms)).toContain(DEFAULT_SPATIAL_RECORDS_ARM);
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
      '--spatial-records-arm: unknown arm nope; known arms: baseline, jev-poc,',
    );
  }, 30_000);
});
