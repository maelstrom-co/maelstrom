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
import {
  loadPlannerScenario,
  plannerScenarioFromCase,
} from './planner-case.js';
import { scenarios, selectScenarios } from './scenarios.js';

const sources = [
  ['planner-preserve', 'preserve'],
  ['planner-deferral', 'generate-content'],
] as const;
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in snapshot tests');
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
function document(caseId: string) {
  return JSON.parse(
    readFileSync(
      new URL(`../../cases/v1/${caseId}.json`, import.meta.url),
      'utf8',
    ),
  );
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

test('case-owned canonical snapshots preserve all 155 pre-change scenarios and their exact ordering', () => {
  expect(scenarios).toHaveLength(155);
  expect(new Set(scenarios.map(({ id }) => id)).size).toBe(155);
  expect(digest(scenarios)).toBe(
    'fc2f28f3ba7e3a258c49dad7cdcd152127c02cb77b42c592f633db59be1aab9b',
  );
  expect(
    digest(
      scenarios.filter(
        ({ id }) => !['preserve', 'generate-content', 'variant'].includes(id),
      ),
    ),
  ).toBe('1b438ff0bbfcc6af889946a833e2723ba2f0a47503173867e83c2ae83963c354');
  expect([scenarios[0].id, scenarios[9].id, scenarios[25].id]).toEqual([
    'preserve',
    'variant',
    'generate-content',
  ]);
  for (const [caseId, id] of sources) {
    const data = document(caseId);
    const scenario = loadPlannerScenario(id);
    expect(selectScenarios('development', [id])).toEqual([scenario]);
    expect(selectScenarios('holdout', [id])).toEqual([]);
    expect(scenario).toEqual({
      id,
      suite: 'development',
      title: data.inputs.scenarioTitle,
      request: data.inputs.request,
      expected: data.expectations,
      ...(id === 'preserve' && { spatial: false }),
    });
    expect(scenario.title).not.toBe(data.title);
    expect(scenario).not.toHaveProperty('history');
    expect(scenario).not.toHaveProperty('response');
    expect(scenario).not.toHaveProperty('scenarioTitle');
  }
  expect(loadPlannerScenario('preserve').spatial).toBe(false);
  expect(loadPlannerScenario('generate-content')).not.toHaveProperty('spatial');
});

test('decoded planner snapshots use JSON values without leaking fixture selectors or mutating input', () => {
  for (const [caseId, id] of sources) {
    const data = document(caseId);
    data.inputs.scenarioTitle = 'Edited title';
    data.inputs.request.context.updateReasons[0].intent = 'Edited intent';
    data.inputs.request.context.chartDimensions.columns = 32;
    data.inputs.request.vessels[0].description = 'Explicit catalog edit';
    data.inputs.history = [{ role: 'assistant', content: 'Retained history' }];
    data.inputs.spatial = true;
    if (id === 'preserve') data.expectations.visible = ['weather-main'];
    const before = structuredClone(data);
    const decoded = plannerScenarioFromCase(data);
    expect(decoded).toEqual({
      id,
      suite: 'development',
      title: data.inputs.scenarioTitle,
      request: data.inputs.request,
      history: data.inputs.history,
      spatial: true,
      expected: data.expectations,
    });
    expect(data).toEqual(before);
    data.inputs.response =
      data.inputs.response === 'defer' ? 'preserve' : 'defer';
    expect(plannerScenarioFromCase(data)).toEqual(decoded);
    data.inputs.history[0].content = 'Caller mutation';
    expect(decoded.history).toEqual(before.inputs.history);
    expect(loadPlannerScenario(id)).not.toEqual(decoded);
  }
});

test('planner snapshots reject missing fields, conflicting identities and unsupported expectation branches', () => {
  for (const [caseId, id] of sources) {
    const original = document(caseId);
    for (const invalid of [
      null,
      {},
      { ...original, id: 'other' },
      {
        ...original,
        scenarioId: id === 'preserve' ? 'generate-content' : 'preserve',
      },
      { ...original, profile: 'planner-replay' },
      { ...original, fixtureId: 'variant-candidate' },
      { ...original, migration: 'reference-backed' },
      { ...original, suite: 'validation' },
      {
        ...original,
        lineage: [{ ...original.lineage[0], scenarioId: 'variant' }],
      },
      { ...original, inputs: { response: original.inputs.response } },
      { ...original, inputs: { ...original.inputs, response: 'unexpected' } },
      {
        ...original,
        inputs: { ...original.inputs, title: 'ambiguous duplicate title' },
      },
      {
        ...original,
        inputs: {
          ...original.inputs,
          history: [{ role: 'system', content: 'unsupported' }],
        },
      },
      { ...original, expectations: { source: 'scenario' } },
      { ...original, expectations: { ...original.expectations, asks: [] } },
      {
        ...original,
        expectations: { ...original.expectations, expectedGates: {} },
      },
    ])
      expect(() => plannerScenarioFromCase(invalid)).toThrow();
    for (const field of ['scenarioTitle', 'request', 'response']) {
      const data = structuredClone(original);
      delete data.inputs[field];
      expect(() => plannerScenarioFromCase(data)).toThrow();
    }
    for (const field of Object.keys(original.expectations)) {
      const data = structuredClone(original);
      delete data.expectations[field];
      expect(() => plannerScenarioFromCase(data)).toThrow();
    }
    for (const expectations of id === 'preserve'
      ? [
          { ...original.expectations, arrangement: [] },
          {
            ...original.expectations,
            arrangement: [{ kind: 'leftOf', a: 'a', b: 'b' }],
          },
        ]
      : [
          { status: 'planned', visible: [], actions: [] },
          { status: 'deferred', deferStage: 'layout' },
        ]) {
      expect(() =>
        plannerScenarioFromCase({ ...original, expectations }),
      ).toThrow();
    }
    for (const corrupt of [
      (data: typeof original) => {
        data.inputs.request.extra = true;
      },
      (data: typeof original) => {
        data.inputs.request.vessels[0].extra = true;
      },
      (data: typeof original) => {
        data.inputs.request.instances[0].variant = 'invalid';
      },
      (data: typeof original) => {
        data.inputs.request.layout.tree = ['ID:unknown'];
      },
    ]) {
      const data = structuredClone(original);
      corrupt(data);
      expect(() => plannerScenarioFromCase(data)).toThrow();
    }
  }
});

test('fixed canonical files drive a fresh live registry and fail closed without TypeScript fallbacks', () => {
  const root = mkdtempSync(join(tmpdir(), 'planner-snapshot-'));
  try {
    const core = join(root, 'src/core');
    const runtime = join(core, 'runtime');
    const cases = join(root, 'cases/v1');
    mkdirSync(core, { recursive: true });
    mkdirSync(runtime, { recursive: true });
    mkdirSync(cases, { recursive: true });
    for (const file of [
      'planner-case.ts',
      'variant-case.ts',
      'case-schema.ts',
      'scenario-snapshot.ts',
      'scenarios.ts',
      'scenario-registry.ts',
      'run-orchestration.ts',
    ])
      copyFileSync(new URL(file, import.meta.url), join(core, file));
    for (const file of ['evaluate.ts', 'operational-telemetry.ts'])
      copyFileSync(
        new URL(`runtime/${file}`, import.meta.url),
        join(runtime, file),
      );
    cpSync(
      new URL('../../scenarios', import.meta.url),
      join(root, 'scenarios'),
      { recursive: true },
    );
    for (const folder of ['fixtures'])
      symlinkSync(
        fileURLToPath(new URL(folder, import.meta.url)),
        join(core, folder),
        'dir',
      );
    symlinkSync(
      fileURLToPath(new URL('../../node_modules', import.meta.url)),
      join(root, 'node_modules'),
      'dir',
    );
    for (const caseId of [
      'scripted-variant',
      ...sources.map(([caseId]) => caseId),
    ])
      writeFileSync(
        join(cases, `${caseId}.json`),
        JSON.stringify(document(caseId)),
      );
    const script = `import { selectScenarios } from ${JSON.stringify(join(core, 'scenarios.ts'))}; console.log(JSON.stringify(selectScenarios('all', ['preserve', 'generate-content'])));`;
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
    expect(run().exitCode).toBe(0);
    for (const [caseId, id] of sources) {
      const path = join(cases, `${caseId}.json`);
      rmSync(path);
      expect(run().exitCode).not.toBe(0);
      for (const invalid of [
        '{',
        ' '.repeat(65_537),
        JSON.stringify(
          document(id === 'preserve' ? 'planner-deferral' : 'planner-preserve'),
        ),
      ]) {
        writeFileSync(path, invalid);
        expect(run().exitCode).not.toBe(0);
      }
      const data = document(caseId);
      data.inputs.scenarioTitle = 'Fresh canonical title';
      data.inputs.request.context.updateReasons[0].intent =
        'Fresh canonical intent';
      data.inputs.history = [{ role: 'user', content: 'Fresh history' }];
      if (id === 'preserve') data.expectations.visible = ['weather-main'];
      writeFileSync(path, JSON.stringify(data));
      const result = run();
      expect(result.exitCode).toBe(0);
      expect(
        JSON.parse(result.stdout.toString()).find(
          (item: { id: string }) => item.id === id,
        ),
      ).toEqual(plannerScenarioFromCase(data));
      writeFileSync(path, JSON.stringify(document(caseId)));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
