import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlannerScenario } from './planner-case.js';
import {
  loadScenarioRegistry,
  scenarioFromDocument,
  scenarioManifestSchema,
} from './scenario-registry.js';
import {
  jsonBackedScenarioIds,
  scenarios,
  selectScenarios,
} from './scenarios.js';
import { loadVariantScenario } from './variant-case.js';

const root = new URL('../../scenarios/v1/', import.meta.url);
function document(id = 'swap') {
  return JSON.parse(
    readFileSync(new URL(`snapshots/${id}.json`, root), 'utf8'),
  );
}
function manifest() {
  return JSON.parse(readFileSync(new URL('index.json', root), 'utf8'));
}
function digest(value: unknown) {
  return createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(
              Object.keys(item)
                .sort()
                .map((key) => [key, item[key]]),
            )
          : item,
      ),
    )
    .digest('hex');
}
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in scenario registry tests');
  };
  network = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(deny, { preconnect: deny }),
  );
});
afterEach(() => {
  try {
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});

test('canonical registry preserves all 155 pre-migration values/order and optional fields losslessly', () => {
  const loaded = loadScenarioRegistry();
  expect(loaded.scenarios).toEqual(scenarios);
  expect(loaded.jsonBackedScenarioIds).toEqual(scenarios.map(({ id }) => id));
  expect(jsonBackedScenarioIds).toEqual(loaded.jsonBackedScenarioIds);
  expect(scenarios).toHaveLength(155);
  expect(new Set(jsonBackedScenarioIds).size).toBe(155);
  // Captured from the generated registry before removing its TypeScript definitions.
  expect(digest(scenarios)).toBe(
    'fc2f28f3ba7e3a258c49dad7cdcd152127c02cb77b42c592f633db59be1aab9b',
  );
  expect(JSON.parse(JSON.stringify(scenarios))).toEqual(scenarios);
  expect(selectScenarios('development')).toHaveLength(97);
  expect(selectScenarios('holdout')).toHaveLength(58);
  expect(scenarios.filter((s) => Object.hasOwn(s, 'history'))).toHaveLength(9);
  expect(scenarios.filter((s) => Object.hasOwn(s, 'spatial'))).toHaveLength(66);
  expect(
    selectScenarios('all', ['variant', 'preserve', 'generate-content']),
  ).toEqual([
    loadPlannerScenario('preserve'),
    loadVariantScenario(),
    loadPlannerScenario('generate-content'),
  ]);
  expect(
    manifest().entries.filter(
      (entry: { kind: string }) => entry.kind === 'snapshot',
    ),
  ).toHaveLength(152);
  for (const entry of manifest().entries) {
    if (entry.kind === 'case') {
      expect(() => document(entry.id)).toThrow();
      continue;
    }
    const input = document(entry.id);
    expect(scenarioFromDocument(input, entry.id)).toEqual(input.scenario);
    expect(selectScenarios('all', [entry.id])).toEqual([input.scenario]);
  }
});

test('JSON changes drive complete request/history/expectations without rebuilding catalogs or inventing fields', () => {
  const input = document();
  input.scenario.title = 'Updated title';
  input.scenario.request.context.updateReasons[0].intent = 'Updated intent';
  input.scenario.request.vessels[0].description = 'Explicit catalog update';
  input.scenario.history = [{ role: 'assistant', content: 'Prior reply' }];
  input.scenario.spatial = false;
  input.scenario.expected = {
    status: 'deferred',
    deferStage: 'layout',
    deferCause: 'arrangement_not_stated',
    visible: [],
    retained: ['calendar-main'],
    tree: [null],
    arrangement: [
      { kind: 'rightOf', a: 'a', b: 'b' },
      { kind: 'weightRatio', a: 'a', b: 'b', min: 0.33, max: 1.7 },
    ],
    actions: [
      {
        instanceId: 'calendar-main',
        action: 'addEvent',
        params: { title: 'A', nested: [1.5, false, null, { x: 'y' }] },
      },
    ],
    asks: [
      { instanceId: 'calendar-main', action: 'addEvent', parameter: 'title' },
    ],
    noListedMatch: [
      { instanceId: 'map-main', action: 'showRoute', parameter: 'destination' },
    ],
    expectedGates: { 'some-gate': 'no' },
  };
  const before = structuredClone(input);
  const decoded = scenarioFromDocument(input, 'swap');
  expect(decoded).toEqual(input.scenario);
  expect(input).toEqual(before);
  input.scenario.expected.actions[0].params.title = 'Changed by caller';
  expect(decoded).toEqual(before.scenario);
  expect(selectScenarios('all', ['swap'])).not.toEqual([decoded]);
});

test('manifest rejects missing/duplicate/case-substituted entries and arbitrary paths', () => {
  const valid = manifest();
  expect(scenarioManifestSchema.parse(valid)).toEqual(valid);
  const mutations: Array<(data: typeof valid) => void> = [
    (data) => {
      data.schemaVersion = 2;
    },
    (data) => {
      data.entries.pop();
    },
    (data) => {
      data.entries.push(data.entries[0]);
    },
    (data) => {
      data.entries[1] = data.entries[2];
    },
    (data) => {
      data.entries[0] = { kind: 'snapshot', id: 'preserve' };
    },
    (data) => {
      data.entries[0] = { kind: 'snapshot', id: 'missing-case' };
    },
    (data) => {
      data.entries[1] = { kind: 'case', id: 'swap' };
    },
    (data) => {
      data.entries[1].path = '/tmp/other.json';
    },
    (data) => {
      data.entries[1].id = '../swap';
    },
    (data) => {
      data.entries[1].id = '/swap';
    },
    (data) => {
      data.extra = true;
    },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    expect(() => scenarioManifestSchema.parse(invalid)).toThrow();
  }
});

test('snapshot validation rejects missing, lossy, malformed and swapped identities without dropping expectations', () => {
  const valid = document();
  for (const mutate of [
    (data: typeof valid) => {
      data.source.scenarioId = 'other';
    },
    (data: typeof valid) => {
      data.source.revision = 'not-pinned';
    },
    (data: typeof valid) => {
      data.scenario.id = 'other';
    },
    (data: typeof valid) => {
      data.scenario.suite = 'validation';
    },
    (data: typeof valid) => {
      data.scenario.extra = true;
    },
    (data: typeof valid) => {
      data.scenario.request.vessels[0].extra = true;
    },
    (data: typeof valid) => {
      data.scenario.request.instances[0].variant = 'unknown';
    },
    (data: typeof valid) => {
      data.scenario.expected.status = 'pass';
    },
    (data: typeof valid) => {
      data.scenario.expected.extra = true;
    },
    (data: typeof valid) => {
      data.scenario.expected.arrangement = [{ kind: 'unknown' }];
    },
    (data: typeof valid) => {
      data.scenario.expected.arrangement = [{ kind: 'leftOf', a: 'a' }];
    },
    (data: typeof valid) => {
      data.scenario.expected.arrangement = [
        { kind: 'dominant', id: 'a', minShare: Infinity },
      ];
    },
    (data: typeof valid) => {
      data.scenario.expected.expectedGates = { gate: 'maybe' };
    },
    (data: typeof valid) => {
      data.scenario.expected.actions = [
        { instanceId: 'a', action: 'b', params: { x: NaN } },
      ];
    },
    (data: typeof valid) => {
      data.scenario.history = [{ role: 'system', content: 'no' }];
    },
    (data: typeof valid) => {
      data.scenario.spatial = 'false';
    },
  ]) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    expect(() => scenarioFromDocument(invalid, 'swap')).toThrow();
  }
  for (const field of ['id', 'suite', 'title', 'request', 'expected']) {
    const invalid = structuredClone(valid);
    delete invalid.scenario[field];
    expect(() => scenarioFromDocument(invalid, 'swap')).toThrow();
  }
  expect(() => scenarioFromDocument(valid, 'other')).toThrow();
});

function mirror() {
  const directory = mkdtempSync(join(tmpdir(), 'scenario-registry-'));
  const core = join(directory, 'src/core');
  mkdirSync(core, { recursive: true });
  for (const file of [
    'scenario-registry.ts',
    'scenario-snapshot.ts',
    'planner-case.ts',
    'variant-case.ts',
    'case-schema.ts',
  ])
    copyFileSync(new URL(file, import.meta.url), join(core, file));
  cpSync(
    new URL('../../scenarios', import.meta.url),
    join(directory, 'scenarios'),
    { recursive: true },
  );
  mkdirSync(join(directory, 'cases/v1'), { recursive: true });
  for (const id of ['scripted-variant', 'planner-preserve', 'planner-deferral'])
    copyFileSync(
      new URL(`../../cases/v1/${id}.json`, import.meta.url),
      join(directory, 'cases/v1', `${id}.json`),
    );
  symlinkSync(
    fileURLToPath(new URL('../../node_modules', import.meta.url)),
    join(directory, 'node_modules'),
    'dir',
  );
  const script = `import {loadScenarioRegistry} from ${JSON.stringify(join(core, 'scenario-registry.ts'))}; console.log(JSON.stringify(loadScenarioRegistry().scenarios.find(s=>s.id==='swap')));`;
  return {
    directory,
    run: () =>
      Bun.spawnSync(
        [
          process.execPath,
          '--no-env-file',
          '--conditions=@maelstrom-co/source',
          '-e',
          script,
        ],
        { stdout: 'pipe', stderr: 'pipe', timeout: 10_000 },
      ),
  };
}

test('fixed registry paths read fresh data and reject missing, oversized, swapped, symlink and non-file snapshots', () => {
  const { directory, run } = mirror();
  try {
    expect(run().exitCode).toBe(0);
    const path = join(directory, 'scenarios/v1/snapshots/swap.json');
    const original = readFileSync(path, 'utf8');
    const changed = JSON.parse(original);
    changed.scenario.expected.actions = [];
    changed.scenario.title = 'Fresh JSON title';
    writeFileSync(path, JSON.stringify(changed));
    const updated = run();
    expect(updated.exitCode).toBe(0);
    expect(JSON.parse(updated.stdout.toString())).toEqual(changed.scenario);
    for (const invalid of [
      '{',
      ' '.repeat(65_537),
      JSON.stringify(document('column')),
    ]) {
      writeFileSync(path, invalid);
      expect(run().exitCode).not.toBe(0);
    }
    rmSync(path);
    expect(run().exitCode).not.toBe(0);
    symlinkSync(new URL('snapshots/swap.json', root), path);
    expect(run().exitCode).not.toBe(0);
    rmSync(path);
    mkdirSync(path);
    expect(run().exitCode).not.toBe(0);
    rmSync(path, { recursive: true });
    if (process.platform !== 'win32') {
      const fifo = Bun.spawnSync(['mkfifo', path]);
      expect(fifo.exitCode).toBe(0);
      expect(run().exitCode).not.toBe(0);
      rmSync(path);
    }
    writeFileSync(path, original);
    const index = join(directory, 'scenarios/v1/index.json');
    writeFileSync(index, '{');
    expect(run().exitCode).not.toBe(0);
    rmSync(index);
    expect(run().exitCode).not.toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

test('registry enforces aggregate budget and rejects symlink snapshot directories before loading', () => {
  const { directory, run } = mirror();
  try {
    const folder = join(directory, 'scenarios/v1/snapshots');
    for (const entry of manifest().entries) {
      if (entry.kind === 'case') continue;
      const path = join(folder, `${entry.id}.json`);
      writeFileSync(path, readFileSync(path, 'utf8').padEnd(64_000));
    }
    const exceeded = run();
    expect(exceeded.exitCode).not.toBe(0);
    expect(exceeded.stderr.toString()).toContain('aggregate byte limit');
    rmSync(folder, { recursive: true });
    symlinkSync(new URL('snapshots/', root), folder, 'dir');
    const linked = run();
    expect(linked.exitCode).not.toBe(0);
    expect(linked.stderr.toString()).toContain('Invalid scenario directory');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
