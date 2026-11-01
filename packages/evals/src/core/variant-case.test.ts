import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
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
import { scenarios, selectScenarios } from './scenarios.js';
import {
  loadVariantScenario,
  variantScenarioFromCase,
} from './variant-case.js';

function document() {
  return JSON.parse(
    readFileSync(
      new URL('../../cases/v1/scripted-variant.json', import.meta.url),
      'utf8',
    ),
  );
}

function digest(value: unknown) {
  const json = JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
  return createHash('sha256').update(json).digest('hex');
}

test('variant canonical JSON preserves the complete pre-migration Scenario and all other 154 entries', () => {
  const pilot = loadVariantScenario();
  expect(digest(pilot)).toBe(
    'acc636b76e7ee8c3b64296d16e01dd1eab83b3584cf923e1e72f5cbefbf79780',
  );
  expect(scenarios).toHaveLength(155);
  expect(scenarios[9].id).toBe('variant');
  expect(digest(scenarios.filter((entry) => entry.id !== 'variant'))).toBe(
    '122460b089de80bb2ea065c6a476312879f7e92a74194e5e4df4dd6f1249ec7b',
  );
  expect(selectScenarios('development', ['variant'])).toEqual([pilot]);
  expect(selectScenarios('holdout', ['variant'])).toEqual([]);
  expect(pilot).not.toHaveProperty('history');
  expect(pilot).not.toHaveProperty('spatial');
  const data = document();
  expect(pilot).toEqual({
    id: data.scenarioId,
    suite: data.suite,
    title: data.inputs.scenarioTitle,
    request: data.inputs.request,
    expected: data.expectations,
  });
});

test('JSON data drives request/catalog/history/title and expectations without consulting the registry', () => {
  const data = document();
  data.inputs.scenarioTitle = 'Edited snapshot';
  data.inputs.request.context.updateReasons = [
    { type: 'user_intent', intent: 'Show hourly instead.' },
  ];
  data.inputs.request.context.chartDimensions.columns = 32;
  data.inputs.request.vessels[0].description =
    'Frozen catalog changed explicitly';
  data.inputs.history = [{ role: 'assistant', content: 'Earlier context' }];
  data.inputs.spatial = false;
  data.expectations.actions[0].action = 'showHourly';
  const snapshot = structuredClone(data);
  const parsed = variantScenarioFromCase(data);
  expect(parsed).toEqual({
    id: 'variant',
    suite: 'development',
    title: data.inputs.scenarioTitle,
    request: data.inputs.request,
    history: data.inputs.history,
    spatial: data.inputs.spatial,
    expected: data.expectations,
  });
  expect(data).toEqual(snapshot);
  data.inputs.history[0].content = 'Mutated after parsing';
  data.expectations.actions = [];
  expect(parsed.history).toEqual(snapshot.inputs.history);
  expect(parsed.expected.actions).toEqual(snapshot.expectations.actions);
  expect(loadVariantScenario()).toEqual(selectScenarios('all', ['variant'])[0]);
});

test('canonical loader rejects missing snapshot, mismatched identity/lineage and unsupported fields', () => {
  const original = document();
  for (const invalid of [
    null,
    {},
    { ...original, id: 'other-case' },
    { ...original, scenarioId: 'preserve' },
    { ...original, suite: 'validation' },
    { ...original, profile: 'planner' },
    { ...original, surface: 'stage' },
    { ...original, fixtureId: 'other-candidate' },
    { ...original, migration: 'reference-backed' },
    {
      ...original,
      lineage: [{ ...original.lineage[0], scenarioId: 'preserve' }],
    },
    { ...original, oracle: { id: 'other', version: 1 } },
    { ...original, inputs: {} },
    { ...original, inputs: { ...original.inputs, module: 'remote' } },
    {
      ...original,
      inputs: {
        ...original.inputs,
        history: [{ role: 'system', content: 'Not supported' }],
      },
    },
    { ...original, expectations: { source: 'scenario' } },
    {
      ...original,
      expectations: { ...original.expectations, arrangement: [] },
    },
    {
      ...original,
      expectations: {
        ...original.expectations,
        actions: [{ instanceId: 'weather-main' }],
      },
    },
  ])
    expect(() => variantScenarioFromCase(invalid)).toThrow();
});

test('ChartRequest validation rejects semantic corruption and unknown fields instead of stripping the snapshot', () => {
  for (const corrupt of [
    (data: ReturnType<typeof document>) => {
      delete data.inputs.request.vessels;
    },
    (data: ReturnType<typeof document>) => {
      data.inputs.request.context.layoutMode = 'grid';
    },
    (data: ReturnType<typeof document>) => {
      data.inputs.request.instances[0].variant = 'not-registered';
    },
    (data: ReturnType<typeof document>) => {
      data.inputs.request.layout.tree = ['ID:unknown'];
    },
    (data: ReturnType<typeof document>) => {
      data.inputs.request.extra = true;
    },
    (data: ReturnType<typeof document>) => {
      data.inputs.request.vessels[0].extra = true;
    },
    (data: ReturnType<typeof document>) => {
      data.inputs.request.context.chartDimensions.extra = true;
    },
  ]) {
    const data = document();
    corrupt(data);
    expect(() => variantScenarioFromCase(data)).toThrow();
  }
});

test('fixed-path loader reads fresh JSON and fails closed on missing, malformed or oversized files', () => {
  const root = mkdtempSync(join(tmpdir(), 'variant-loader-'));
  try {
    const core = join(root, 'src/core');
    const cases = join(root, 'cases/v1');
    mkdirSync(core, { recursive: true });
    mkdirSync(cases, { recursive: true });
    for (const file of [
      'variant-case.ts',
      'case-schema.ts',
      'scenario-snapshot.ts',
    ])
      copyFileSync(new URL(file, import.meta.url), join(core, file));
    symlinkSync(
      fileURLToPath(new URL('../../node_modules', import.meta.url)),
      join(root, 'node_modules'),
      'dir',
    );
    const script = `import { loadVariantScenario } from ${JSON.stringify(join(core, 'variant-case.ts'))}; console.log(JSON.stringify(loadVariantScenario()));`;
    const run = () =>
      Bun.spawnSync(
        [
          process.execPath,
          '--no-env-file',
          '--conditions=@maelstrom-co/source',
          '-e',
          script,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
    const path = join(cases, 'scripted-variant.json');
    expect(run().exitCode).not.toBe(0);
    writeFileSync(path, '{');
    expect(run().exitCode).not.toBe(0);
    writeFileSync(path, ' '.repeat(65_537));
    expect(run().exitCode).not.toBe(0);
    const data = document();
    data.scenarioId = 'preserve';
    writeFileSync(path, JSON.stringify(data));
    expect(run().exitCode).not.toBe(0);
    data.scenarioId = 'variant';
    data.inputs.scenarioTitle = 'Read from canonical JSON';
    data.inputs.history = [{ role: 'user', content: 'Prior turn from JSON' }];
    data.expectations.actions[0].action = 'showHourly';
    writeFileSync(path, JSON.stringify(data));
    const result = run();
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual(
      variantScenarioFromCase(data),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
