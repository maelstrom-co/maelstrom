import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { scenarios } from '../../packages/evals/src/core/scenarios.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';
import * as runtimeFixtures from './runtime-fixtures.js';

const canonical = fileURLToPath(
  new URL('../../packages/evals/cases/v1/', import.meta.url),
);
let root: string;
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eval-cases-'));
  cpSync(canonical, root, { recursive: true });
  const deny = () => {
    throw new Error('No network in case validation');
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
    rmSync(root, { recursive: true, force: true });
  }
});
function json(file: string) {
  return JSON.parse(readFileSync(join(root, file), 'utf8'));
}
function save(file: string, value: unknown) {
  writeFileSync(join(root, file), `${JSON.stringify(value, null, 2)}\n`);
}
async function run(id: string) {
  const item = loadOfflineCases(root).find((item) => item.definition.id === id);
  if (!item) throw new Error('Missing selected case');
  return evaluateSample(
    {
      runId: 'json-controls',
      caseId: id,
      runtimeId: item.definition.profile,
      sample: 1,
    },
    caseAdapter(item),
  );
}

test('declared-scope completion keeps human review independent and rejects obsolete coverage fields', () => {
  const ids = [
    'assistant-identity-subset',
    'assistant-non-json-subset',
    'assistant-json-refusal-lexical',
    'no-dual-target-plan',
    'history-assistant-injection-subset',
    'labs-state-reset-subset',
    'labs-state-reset-synthetic',
    'labs-state-reset-optional-enum',
    'weather-current-noop-subset',
    'weather-action-backed-transition',
    'weather-deterministic-cycle',
    'weather-deterministic-return',
  ];
  const cases = loadOfflineCases(root);
  for (const id of ids) {
    const definition = cases.find(
      (item) => item.definition.id === id,
    )?.definition;
    if (!definition) throw new Error(`Missing bounded case ${id}`);
    expect(definition.title).toContain('COMPLETE');
    expect(definition.purpose).toContain('COMPLETE');
    expect(definition.review).toBe('pending-human-review');
    expect(definition.synthetic).toBe(true);
    expect(definition.expectations).not.toHaveProperty('requiredUnresolved');
    const file = `${id}.json`;
    const original = json(file);
    if ('coverage' in definition.expectations) {
      expect(definition.expectations.coverage).toBe('COMPLETE');
      save(file, {
        ...original,
        expectations: { ...original.expectations, coverage: 'PARTIAL' },
      });
      expect(() => loadOfflineCases(root)).toThrow();
    }
    save(file, {
      ...original,
      expectations: { ...original.expectations, requiredUnresolved: [] },
    });
    expect(() => loadOfflineCases(root)).toThrow();
    save(file, original);
  }
});

test('all indexed definitions and fixtures validate with exact lineage and byte digests', () => {
  const cases = loadOfflineCases(root);
  expect(cases).toHaveLength(43);
  expect(json('index.json').fixtures).toHaveLength(35);
  expect(new Set(cases.map((item) => item.definition.profile)).size).toBe(30);
  const expected = [
    [
      'weather-action-backed-transition',
      '/items/38',
      'cap-maelstrom-edge-deterministic-actions',
    ],
    ['three-vessel-addition', '/items/34', 'cap-maelstrom-multivessel-three'],
    [
      'weather-current-noop-subset',
      '/items/37',
      'cap-maelstrom-edge-deterministic-actions',
    ],
    [
      'weather-deterministic-cycle',
      '/items/39',
      'cap-maelstrom-edge-deterministic-actions',
    ],
    [
      'weather-deterministic-return',
      '/items/40',
      'cap-maelstrom-edge-deterministic-actions',
    ],
    [
      'history-assistant-injection-subset',
      '/items/24',
      'cap-history-assistant-message-injection',
    ],
    [
      'assistant-identity-subset',
      '/items/1',
      'reg-maelstrom-multiturn-assistant-identity-consistency',
    ],
    ['assistant-exact-text', '/items/2', 'cap-ai-chat-single-message'],
    [
      'assistant-non-json-subset',
      '/items/13',
      'cap-maelstrom-structured-view-model-validity',
    ],
    [
      'assistant-json-refusal-lexical',
      '/items/13',
      'cap-maelstrom-structured-view-model-validity',
    ],
    ['no-dual-target-plan', '/items/16', 'cap-maelstrom-conv-clarification'],
    ['cross-vessel', '/items/35', 'cap-maelstrom-multiturn-cross-vessel'],
    [
      'multivessel-add-instance',
      '/items/33',
      'cap-maelstrom-multivessel-add-instance',
    ],
    [
      'labs-state-reset-subset',
      '/items/32',
      'cap-maelstrom-multiturn-state-reset',
    ],
    [
      'labs-state-reset-synthetic',
      '/items/32',
      'cap-maelstrom-multiturn-state-reset',
    ],
    [
      'labs-state-reset-optional-enum',
      '/items/32',
      'cap-maelstrom-multiturn-state-reset',
    ],
    [
      'labs-multi-marker-final',
      '/items/29',
      'cap-maelstrom-multiturn-labs-multi-markers',
    ],
    ['grid-no-overlap', '/items/12', 'cap-maelstrom-grid-no-overlap'],
    ['tiling-tree-validity', '/items/11', 'cap-maelstrom-tiling-tree-validity'],
    ['tiling-add-vessel', '/items/36', 'cap-maelstrom-tiling-add-vessel'],
    [
      'calendar-week-nav',
      '/items/28',
      'cap-maelstrom-multiturn-calendar-week-nav',
    ],
    [
      'weather-delayed-action',
      '/items/31',
      'cap-maelstrom-multiturn-delayed-action',
    ],
    [
      'target-disambiguation',
      '/items/23',
      'cap-maelstrom-multiturn-target-disambiguation',
    ],
    [
      'labs-select-marker',
      '/items/22',
      'cap-maelstrom-multiturn-labs-select-marker',
    ],
    [
      'weather-reuse-weekly',
      '/items/21',
      'cap-maelstrom-multiturn-weather-reuse-weekly',
    ],
    ['weather-weekly', '/items/14', 'cap-maelstrom-vessel-mutation-action'],
    ['calendar-week', '/items/25', 'cap-maelstrom-vessel-calendar-week'],
    ['weather-hourly', '/items/26', 'cap-maelstrom-vessel-weather-hourly'],
    ['labs-upload', '/items/27', 'cap-maelstrom-vessel-labs-upload'],
    ['invalid-action', '/items/17', 'cap-maelstrom-edge-invalid-action'],
    ['wrong-enum', '/items/18', 'cap-maelstrom-edge-wrong-enum'],
    ['out-of-scope-no-mutation', '/items/20', 'cap-maelstrom-conv-refusal'],
    [
      'noop-preservation',
      '/items/19',
      'cap-maelstrom-single-noop-preservation',
    ],
    [
      'weather-chain',
      '/items/30',
      'cap-maelstrom-multiturn-weather-variant-chain',
    ],
    [
      'client-order',
      '/items/15',
      'reg-maelstrom-transition-action-runner-race',
    ],
  ];
  const represented = new Set(
    cases.flatMap((item) =>
      item.definition.lineage.flatMap((source) =>
        source.source === 'legacy' ? [source.pointer] : [],
      ),
    ),
  );
  expect(represented.size).toBe(32);
  expect(represented).toEqual(new Set(expected.map(([, pointer]) => pointer)));
  const unrepresented = Array.from(
    { length: 41 },
    (_, index) => `/items/${index}`,
  ).filter((pointer) => !represented.has(pointer));
  expect(unrepresented).toHaveLength(9);
  expect(represented).toContain('/items/34');
  // Shared task IDs retain four separately accounted dataset rows.
  for (const index of [37, 38, 39, 40])
    expect(represented).toContain(`/items/${index}`);
  // All nine dataset-only targets remain unregistered, not silently covered.
  for (const index of [0, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(unrepresented).toContain(`/items/${index}`);
  expect(scenarios).toHaveLength(155);
  for (const [id, pointer, taskId] of expected) {
    const item = cases.find((item) => item.definition.id === id);
    expect(item?.definition.lineage).toContainEqual({
      source: 'legacy',
      revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
      path: 'langfuse/maelstrom-eval-dataset.v1.json',
      pointer,
      taskId,
      datasetId: taskId,
    });
  }
  for (const item of cases) {
    expect(item.caseDigest).toBe(
      createHash('sha256')
        .update(readFileSync(join(root, `${item.definition.id}.json`)))
        .digest('hex'),
    );
    expect(item.fixtureDigest).toBe(
      createHash('sha256')
        .update(readFileSync(join(root, 'fixtures', `${item.fixture.id}.json`)))
        .digest('hex'),
    );
    expect(Object.isFrozen(item.definition.inputs)).toBe(true);
    expect(item.definition.review).toBe('pending-human-review');
    if (item.definition.scenarioId)
      expect(item.definition.migration).toBe(
        ['scripted-variant', 'planner-preserve', 'planner-deferral'].includes(
          item.definition.id,
        )
          ? 'json-backed'
          : 'reference-backed',
      );
  }
});

test('JSON weather turns, expectations and fixture state actually drive execution and verdicts', async () => {
  const original = await run('weather-weekly');
  expect(original.evaluation).toBe('pass');
  const file = 'weather-weekly.json';
  const data = json(file);
  data.inputs.turns = ['hourly', 'current'];
  data.expectations.variants = ['hourly', 'current'];
  save(file, data);
  const changed = await run('weather-weekly');
  expect(changed.evaluation).toBe('pass');
  expect(changed.provenance).not.toBe(original.provenance);
  expect(changed.observation).toMatchObject([
    { input: 'hourly', resultingState: { variant: 'hourly' } },
    { input: 'current', resultingState: { variant: 'current' } },
  ]);
  data.expectations.variants = ['weekly', 'current'];
  save(file, data);
  expect((await run('weather-weekly')).evaluation).toBe('fail');
  data.expectations.variants = ['hourly', 'current'];
  save(file, data);
  const fixture = json('fixtures/weather.json');
  fixture.data = { instanceId: 'synthetic-renamed', initialVariant: 'weekly' };
  save('fixtures/weather.json', fixture);
  const renamed = await run('weather-weekly');
  expect(renamed.evaluation).toBe('pass');
  expect(renamed.observation).toMatchObject([
    { state: { instanceId: 'synthetic-renamed', variant: 'weekly' } },
    {},
  ]);
});

test('JSON client expectations are scored, never substituted as observed effects', async () => {
  expect((await run('client-order')).evaluation).toBe('pass');
  const data = json('client-order.json');
  data.expectations.effects[0].variant = 'summary';
  save('client-order.json', data);
  const failed = await run('client-order');
  expect(failed.evaluation).toBe('fail');
  expect(failed.failures).toContain('openBreakdown observed the wrong Variant');
  expect(failed.observation).toMatchObject({
    effects: expect.arrayContaining([
      expect.objectContaining({
        action: 'openBreakdown',
        variant: 'breakdown',
      }),
      expect.objectContaining({ action: 'configure', variant: 'current' }),
    ]),
  });
});

test('JSON stage responses and scenario references change the real stage verdict', async () => {
  expect((await run('stage-handoff')).disposition).toBe('handed_off');
  const data = json('stage-handoff.json');
  data.inputs.destination = { kind: 'literal', value: 'Studio Vortex HQ' };
  save('stage-handoff.json', data);
  expect((await run('stage-handoff')).evaluation).toBe('pass');
  data.inputs.destination.value = 'unlisted-fictional-place';
  save('stage-handoff.json', data);
  expect((await run('stage-handoff')).evaluation).toBe('fail');
  const planner = json('planner-preserve.json');
  planner.expectations.actions = [
    { instanceId: 'weather-main', action: 'showWeekly' },
  ];
  save('planner-preserve.json', planner);
  expect((await run('planner-preserve')).evaluation).toBe('fail');
});

test('whole catalog validation rejects unknown names, incompatible shapes and missing lineage before execution', () => {
  const file = 'weather-weekly.json';
  const original = json(file);
  for (const change of [
    { schemaVersion: 2 },
    { profile: 'not-registered' },
    { oracle: { id: 'stage-judgement', version: 1 } },
    { inputs: { turns: ['weekly'], module: './arbitrary.ts' } },
    { inputs: { turns: [] } },
    { inputs: { turns: ['invented'] } },
    { expectations: { variants: ['weekly'], command: 'run' } },
    { fixtureId: 'planner-script' },
    { fixtureId: 'absent' },
    { surface: 'client-application' },
    { lineage: [] },
    { migration: 'reference-backed' },
    { scenarioId: 'preserve' },
    { executable: 'anything' },
  ]) {
    save(file, { ...original, ...change });
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  const planner = json('planner-preserve.json');
  for (const scenarioId of ['no-such-scenario', 'variant']) {
    save('planner-preserve.json', { ...planner, scenarioId });
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('duplicate case IDs fail but duplicate legacy dataset IDs at different row pointers are retained', () => {
  const one = json('weather-weekly.json');
  const two = json('weather-chain.json');
  save('weather-chain.json', { ...two, id: one.id });
  expect(() => loadOfflineCases(root)).toThrow('Duplicate case');
  two.lineage[0].taskId = one.lineage[0].taskId;
  two.lineage[0].datasetId = one.lineage[0].datasetId;
  save('weather-chain.json', two);
  const loaded = loadOfflineCases(root).filter(
    (item) => item.definition.profile === 'weather-session',
  );
  expect(loaded).toHaveLength(2);
  expect(loaded.map((item) => item.definition.lineage[0])).toMatchObject([
    { datasetId: one.lineage[0].datasetId, pointer: '/items/14' },
    { datasetId: one.lineage[0].datasetId, pointer: '/items/30' },
  ]);
});

test('missing, oversized and symlink files cannot silently fall back to code defaults', () => {
  const path = join(root, 'weather-weekly.json');
  const original = readFileSync(path);
  rmSync(path);
  expect(() => loadOfflineCases(root)).toThrow();
  writeFileSync(path, ' '.repeat(65_537));
  expect(() => loadOfflineCases(root)).toThrow('bounded');
  rmSync(path);
  symlinkSync(join(canonical, 'weather-weekly.json'), path);
  expect(() => loadOfflineCases(root)).toThrow();
  rmSync(path);
  writeFileSync(path, original);
  const index = json('index.json');
  index.cases.push('../escape.json');
  save('index.json', index);
  expect(() => loadOfflineCases(root)).toThrow();
});

test('indexed fixtures without a referencing case reject even if their data was never profile-validated', () => {
  const index = json('index.json');
  index.fixtures.push('unused.json');
  save('index.json', index);
  const fixture = { ...json('fixtures/weather.json'), id: 'unused' };
  for (const data of [{ command: 'invalid-profile-data' }, fixture.data]) {
    save('fixtures/unused.json', { ...fixture, data });
    expect(() => loadOfflineCases(root)).toThrow(
      'Unreferenced fixture: unused',
    );
  }
});

test('symlink roots and fixture directories reject before reading their contents', () => {
  const link = join(root, 'linked-root');
  symlinkSync(canonical, link, 'dir');
  for (const path of [link, `${link}/`])
    expect(() => loadOfflineCases(path)).toThrow(
      'Expected regular case directory',
    );
  rmSync(join(root, 'fixtures'), { recursive: true });
  symlinkSync(join(canonical, 'fixtures'), join(root, 'fixtures'), 'dir');
  expect(() => loadOfflineCases(root)).toThrow(
    'Expected regular fixture directory',
  );
});

const fifoCommand = process.platform === 'win32' ? null : Bun.which('mkfifo');
test.skipIf(!fifoCommand || typeof constants.O_NONBLOCK !== 'number')(
  'FIFO case files reject promptly without waiting for a writer',
  () => {
    if (!fifoCommand) throw new Error('FIFO creation unavailable');
    const path = join(root, 'weather-weekly.json');
    rmSync(path);
    const created = spawnSync(fifoCommand, [path], { timeout: 2_000 });
    expect(created.error).toBeUndefined();
    expect(created.status).toBe(0);
    // A subprocess deadline bounds the regression even if openSync blocks again.
    const probe = spawnSync(
      process.execPath,
      [
        '--conditions=@maelstrom-co/source',
        '--eval',
        `globalThis.fetch = () => { throw new Error('No network in FIFO probe'); };
         const { loadOfflineCases } = await import(${JSON.stringify(new URL('./cases.ts', import.meta.url).href)});
         try { loadOfflineCases(${JSON.stringify(root)}); process.exitCode = 1; }
         catch (error) {
           if (!(error instanceof Error) || !error.message.includes('Expected bounded regular JSON file')) throw error;
         }`,
      ],
      { timeout: 2_000, killSignal: 'SIGKILL' },
    );
    expect(probe.error).toBeUndefined();
    expect(probe.signal).toBeNull();
    expect(probe.status).toBe(0);
  },
);

test('fixture indexes and payload schemas reject duplicates, unknown properties and mismatched IDs', () => {
  const original = json('fixtures/weather.json');
  for (const change of [
    { id: 'planner-script' },
    { kind: 'route-script' },
    { data: { ...original.data, command: 'run' } },
    { data: {} },
  ]) {
    save('fixtures/weather.json', { ...original, ...change });
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('legacy Vessel JSON changes navigation and retained state independently of expectations', async () => {
  for (const [id, action, variant, instanceId] of [
    ['calendar-week', 'showWeekly', 'week', 'calendar-main'],
    ['weather-hourly', 'showHourly', 'hourly', 'weather-main'],
    ['labs-upload', 'showUpload', 'upload', 'labs-main'],
  ]) {
    const observed = await run(id);
    expect(observed.evaluation).toBe('pass');
    expect(observed.observation).toMatchObject([
      {
        input: { instanceId, action },
        output: {
          executionPlan: [{ instanceId, action }],
          instances: [{ instanceId, variant }],
        },
        resultingState: { instances: [{ instanceId, variant }] },
      },
    ]);
    const file = `${id}.json`;
    const data = json(file);
    data.expectations.variant = 'wrong-but-valid-label';
    save(file, data);
    expect((await run(id)).evaluation).toBe('fail');
    data.expectations.variant = variant;
    data.expectations.action = 'wrongAction';
    save(file, data);
    expect((await run(id)).evaluation).toBe('fail');
    data.expectations.action = action;
    data.expectations.instanceId = 'wrong-target';
    save(file, data);
    expect((await run(id)).evaluation).toBe('fail');
  }
});

test('transition script uses JSON Action tables, identities and initial state rather than oracle values', async () => {
  const data = json('calendar-week.json');
  const fixture = json('fixtures/calendar-transitions.json');
  fixture.data.instances[0].instanceId = 'renamed-calendar';
  data.inputs.instanceId = 'renamed-calendar';
  data.expectations.instanceId = 'renamed-calendar';
  save('fixtures/calendar-transitions.json', fixture);
  save('calendar-week.json', data);
  expect((await run('calendar-week')).evaluation).toBe('pass');

  fixture.data.instances[0].variant = 'week';
  data.inputs.action = 'showMonthly';
  data.expectations.action = 'showMonthly';
  data.expectations.variant = 'month';
  save('fixtures/calendar-transitions.json', fixture);
  save('calendar-week.json', data);
  const changed = await run('calendar-week');
  expect(changed.evaluation).toBe('pass');
  expect(changed.observation).toMatchObject([
    {
      state: { instances: [{ variant: 'week' }] },
      resultingState: { instances: [{ variant: 'month' }] },
    },
  ]);
  fixture.data.vessel.variants[1].actions[0].transitionsTo = 'week';
  save('fixtures/calendar-transitions.json', fixture);
  const mismatch = await run('calendar-week');
  expect(mismatch.evaluation).toBe('fail');
  expect(mismatch.observation).toMatchObject([
    {
      resultingState: { instances: [{ variant: 'week' }] },
    },
  ]);
});

test('transition profile rejects invalid script, schema and fixture references before execution', () => {
  const original = json('calendar-week.json');
  for (const changes of [
    { inputs: { ...original.inputs, action: 'showWeek' } },
    { inputs: { ...original.inputs, action: 'showMonthly' } },
    { inputs: { ...original.inputs, instanceId: 'absent' } },
    { inputs: { ...original.inputs, module: './arbitrary.ts' } },
    { expectations: { ...original.expectations, execute: 'code' } },
    { oracle: { id: 'weather-transitions', version: 1 } },
    { fixtureId: 'weather' },
    { fixtureId: 'weather-transitions' },
    { lineage: [] },
    { migration: 'reference-backed' },
  ]) {
    save('calendar-week.json', { ...original, ...changes });
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save('calendar-week.json', original);
  const fixture = json('fixtures/calendar-transitions.json');
  const mutations = [
    (data: typeof fixture.data) => {
      data.vessel.variants.push(data.vessel.variants[0]);
    },
    (data: typeof fixture.data) => {
      data.vessel.variants[0].actions.push(data.vessel.variants[0].actions[0]);
    },
    (data: typeof fixture.data) => {
      data.vessel.variants[0].actions[0].transitionsTo = 'missing';
    },
    (data: typeof fixture.data) => {
      data.instances[0].variant = 'missing';
    },
    (data: typeof fixture.data) => {
      data.instances[0].vesselId = 'weather';
    },
    (data: typeof fixture.data) => {
      data.instances.push(data.instances[0]);
    },
    (data: typeof fixture.data) => {
      data.vessel.command = 'execute';
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(fixture);
    mutate(copy.data);
    save('fixtures/calendar-transitions.json', copy);
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('JSON response constraints drive independent input, rule and fixture-contract behavior', async () => {
  for (const id of ['invalid-action', 'wrong-enum', 'noop-preservation'])
    expect((await run(id)).evaluation).toBe('pass');
  const invalid = json('invalid-action.json');
  invalid.inputs.intent = 'Synthetic edited intent';
  invalid.inputs.response.executionPlan = [
    { instanceId: 'weather-main', action: 'zoom' },
  ];
  save('invalid-action.json', invalid);
  const changed = await run('invalid-action');
  expect(changed.evaluation).toBe('fail');
  expect(changed.observation).toMatchObject([
    {
      input: { intent: 'Synthetic edited intent' },
      output: { executionPlan: [{ action: 'zoom' }] },
    },
  ]);
  const weather = json('fixtures/weather-response.json');
  weather.data.variants[0].actions.push('zoom');
  save('fixtures/weather-response.json', weather);
  expect((await run('invalid-action')).evaluation).toBe('pass');
  invalid.expectations.rule = 'no-op';
  save('invalid-action.json', invalid);
  expect((await run('invalid-action')).evaluation).toBe('fail');

  const enums = json('wrong-enum.json');
  enums.inputs.response.executionPlan = [
    {
      instanceId: 'labs-main',
      action: 'selectMarker',
      params: { markerSlug: 'hemoglobin' },
    },
    {
      instanceId: 'labs-main',
      action: 'selectMarker',
      params: { markerSlug: 'cholesterol' },
    },
  ];
  save('wrong-enum.json', enums);
  expect((await run('wrong-enum')).evaluation).toBe('fail');
  const labs = json('fixtures/labs-response.json');
  expect(labs.data.markerSlugs).toEqual(['hemoglobin', 'platelets', 'glucose']);
  labs.data.markerSlugs.push('cholesterol');
  save('fixtures/labs-response.json', labs);
  expect((await run('wrong-enum')).evaluation).toBe('pass');
});

test('constraint profile rejects incompatible rules/fixtures and executable or malformed configuration before execution', () => {
  const file = 'invalid-action.json';
  const original = json(file);
  for (const change of [
    { oracle: { id: 'weather-transitions', version: 1 } },
    { expectations: { rule: 'marker-enum' } },
    { expectations: { rule: 'arbitrary', module: 'anything' } },
    { fixtureId: 'weather-transitions' },
    { inputs: { ...original.inputs, command: 'run' } },
    {
      inputs: {
        ...original.inputs,
        response: { ...original.inputs.response, executionPlan: null },
      },
    },
    { lineage: [] },
  ]) {
    save(file, { ...original, ...change });
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  const fixture = json('fixtures/weather-response.json');
  for (const data of [
    { ...fixture.data, variants: [] },
    {
      ...fixture.data,
      variants: [{ name: 'current', actions: ['showHourly', 'showHourly'] }],
    },
    {
      ...fixture.data,
      instances: [fixture.data.instances[0], fixture.data.instances[0]],
    },
    {
      ...fixture.data,
      instances: [{ ...fixture.data.instances[0], variant: 'unknown' }],
    },
    { ...fixture.data, module: './code.ts' },
  ]) {
    save('fixtures/weather-response.json', { ...fixture, data });
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('D18 JSON layout evidence is observed without reconstructing missing layout from top-level Instances', async () => {
  const original = json('invalid-action.json');
  expect((await run('invalid-action')).evaluation).toBe('pass');
  const missing = structuredClone(original);
  delete missing.inputs.response.layout;
  save('invalid-action.json', missing);
  const absent = await run('invalid-action');
  expect(absent.execution).toBe('completed');
  expect(absent.evaluation).toBe('fail');
  expect(absent.failures).toContain('Expected tiling layout evidence');
  const changed = structuredClone(original);
  changed.inputs.response.layout.instances[0].variant = 'hourly';
  save('invalid-action.json', changed);
  const mutated = await run('invalid-action');
  expect(mutated.evaluation).toBe('fail');
  expect(mutated.observation).toMatchObject([
    {
      output: {
        instances: [{ variant: 'current' }],
        layout: { type: 'tiling', instances: [{ variant: 'hourly' }] },
      },
    },
  ]);
});

test('D22 requests, observations and target expectations remain independent JSON data', async () => {
  const file = 'weather-reuse-weekly.json';
  const fixtureFile = 'fixtures/weather-reuse-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  const baseline = await run('weather-reuse-weekly');
  expect(baseline.evaluation).toBe('pass');
  const expectation = structuredClone(original);
  expectation.expectations.instanceId = 'other-weather';
  save(file, expectation);
  const mismatch = await run('weather-reuse-weekly');
  expect(mismatch.evaluation).toBe('fail');
  expect(mismatch.observation).toEqual(baseline.observation);
  const request = structuredClone(original);
  request.inputs.turns[0].intent =
    'A synthetic changed request, not model-interpreted';
  save(file, request);
  const changedRequest = await run('weather-reuse-weekly');
  expect(changedRequest.evaluation).toBe('pass');
  expect(changedRequest.observation).toMatchObject([
    { input: { intent: request.inputs.turns[0].intent } },
    {},
    {},
    {},
  ]);
  save(file, original);
  const wrong = structuredClone(fixture);
  wrong.data.responses[1].executionPlan = [];
  save(fixtureFile, wrong);
  const missing = await run('weather-reuse-weekly');
  expect(missing.evaluation).toBe('fail');
  expect(missing.failures).toContain(
    'Turn 1 is missing the decisive weekly Action',
  );
  expect(missing.observation).toMatchObject([
    {},
    { output: { executionPlan: [] } },
    {},
    {},
  ]);
  expect(missing.provenance).not.toBe(baseline.provenance);
  const noDetailChange = structuredClone(fixture);
  noDetailChange.data.responses[0] = {
    ...structuredClone(fixture.data.initial),
    executionPlan: [],
  };
  save(fixtureFile, noDetailChange);
  const alternate = await run('weather-reuse-weekly');
  expect(alternate.evaluation).toBe('pass');
  expect(alternate.observation).toMatchObject([
    { output: { instances: [{ variant: 'current' }] } },
    { state: { instances: [{ variant: 'current' }] } },
    {},
    {},
  ]);
});

test('D22 loader rejects malformed/unbounded fixture evidence and unregistered profile constraints', () => {
  const file = 'weather-reuse-weekly.json';
  const fixtureFile = 'fixtures/weather-reuse-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  for (const mutate of [
    (value: typeof original) => {
      value.inputs.turns.pop();
    },
    (value: typeof original) => {
      value.inputs.turns.push(value.inputs.turns[0]);
    },
    (value: typeof original) => {
      value.inputs.turns[0].intent = '';
    },
    (value: typeof original) => {
      value.inputs.turns[0].command = 'execute';
    },
    (value: typeof original) => {
      value.expectations.action = 'invented';
    },
    (value: typeof original) => {
      value.expectations.variant = 'hourly';
    },
    (value: typeof original) => {
      value.expectations.forbidNewInstances = false;
    },
    (value: typeof original) => {
      value.expectations.scorer = 'module';
    },
    (value: typeof original) => {
      value.oracle.id = 'weather-transitions';
    },
    (value: typeof original) => {
      value.fixtureId = 'weather';
    },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    save(file, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  for (const mutate of [
    (value: typeof fixture) => {
      value.kind = 'weather-state';
    },
    (value: typeof fixture) => {
      value.data.responses.pop();
    },
    (value: typeof fixture) => {
      value.data.responses.push(value.data.responses[0]);
    },
    (value: typeof fixture) => {
      delete value.data.initial;
    },
    (value: typeof fixture) => {
      value.data.initial.instances[0].variant = 'weekly';
    },
    (value: typeof fixture) => {
      value.data.initial.instances.push(value.data.initial.instances[0]);
    },
    (value: typeof fixture) => {
      value.data.initial.layout.type = 'grid';
    },
    (value: typeof fixture) => {
      value.data.initial.layout.instances[0].instanceId = 'other';
    },
    (value: typeof fixture) => {
      delete value.data.responses[3].layout;
    },
    (value: typeof fixture) => {
      delete value.data.responses[1].executionPlan;
    },
    (value: typeof fixture) => {
      value.data.responses[0].executionPlan = Array(21).fill({
        instanceId: 'weather-main',
        action: 'showHourly',
      });
    },
    (value: typeof fixture) => {
      value.data.responses[0].instances = Array(21).fill(
        value.data.initial.instances[0],
      );
    },
    (value: typeof fixture) => {
      value.data.responses[0].layout.instances = Array(21).fill(
        value.data.initial.instances[0],
      );
    },
    (value: typeof fixture) => {
      value.data.responses[0].layout.type = 'unknown';
    },
    (value: typeof fixture) => {
      value.data.responses[0].layout.command = 'execute';
    },
  ]) {
    const changed = structuredClone(fixture);
    mutate(changed);
    save(fixtureFile, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('D21 JSON preserves source identity and scores structural no-mutation without semantic refusal', async () => {
  const file = 'out-of-scope-no-mutation.json';
  const original = json(file);
  expect(original).toMatchObject({
    fixtureId: 'weather-response',
    synthetic: true,
    migration: 'legacy-derived-harness',
    review: 'pending-human-review',
    expectations: { rule: 'no-op-tiling' },
    inputs: {
      intent: 'Book a flight to New York based on the weather',
      response: { assistantText: 'The weather is 72 degrees.' },
    },
  });
  const baseline = await run('out-of-scope-no-mutation');
  expect(baseline.evaluation).toBe('pass');
  const missing = structuredClone(original);
  delete missing.inputs.response.layout;
  save(file, missing);
  const absent = await run('out-of-scope-no-mutation');
  expect(absent.evaluation).toBe('fail');
  expect(absent.failures).toEqual(['Expected tiling layout evidence']);
  expect(absent.observation).toMatchObject([
    { output: { instances: [{ variant: 'current' }] } },
  ]);
  missing.expectations.rule = 'no-op';
  save(file, missing);
  const relaxed = await run('out-of-scope-no-mutation');
  expect(relaxed.evaluation).toBe('pass');
  expect(relaxed.observation).toEqual(absent.observation);
  const action = structuredClone(original);
  action.inputs.response.executionPlan = [
    { instanceId: 'weather-main', action: 'showHourly' },
  ];
  save(file, action);
  expect((await run('out-of-scope-no-mutation')).evaluation).toBe('fail');
  action.expectations.rule = 'valid-actions-preserve-state';
  save(file, action);
  expect((await run('out-of-scope-no-mutation')).evaluation).toBe('pass');
  for (const expectations of [
    { rule: 'no-op-tiling', semanticRefusal: true },
    { rule: 'no-op-grid' },
  ]) {
    save(file, { ...original, expectations });
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('D23 JSON requests, expected slug and fixture observations remain independent', async () => {
  const file = 'labs-select-marker.json';
  const fixtureFile = 'fixtures/labs-select-marker-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  expect(original).toMatchObject({
    synthetic: true,
    review: 'pending-human-review',
    migration: 'legacy-derived-harness',
    profile: 'legacy-labs-select-marker',
    fixtureId: 'labs-select-marker-script',
    expectations: { markerSlug: 'hemoglobin', action: 'selectMarker' },
  });
  const baseline = await run('labs-select-marker');
  expect(baseline.evaluation).toBe('pass');
  for (const expectations of [
    { ...original.expectations, markerSlug: 'platelets' },
    { ...original.expectations, instanceId: 'other-labs' },
  ]) {
    save(file, { ...original, expectations });
    const mismatch = await run('labs-select-marker');
    expect(mismatch.evaluation).toBe('fail');
    expect(mismatch.observation).toEqual(baseline.observation);
  }
  const changedRequest = structuredClone(original);
  changedRequest.inputs.turns[0].intent =
    'Synthetic request evidence, not model-interpreted';
  save(file, changedRequest);
  const request = await run('labs-select-marker');
  expect(request.evaluation).toBe('pass');
  expect(request.observation).toMatchObject([
    { input: { intent: changedRequest.inputs.turns[0].intent } },
    {},
    {},
    {},
  ]);
  save(file, original);
  const wrong = structuredClone(fixture);
  wrong.data.responses[1].executionPlan[0].params.markerSlug = 'glucose';
  save(fixtureFile, wrong);
  const changedResponse = await run('labs-select-marker');
  expect(changedResponse.evaluation).toBe('fail');
  expect(changedResponse.observation).toMatchObject([
    {},
    { output: { executionPlan: [{ params: { markerSlug: 'glucose' } }] } },
    {},
    {},
  ]);
  expect(changedResponse.provenance).not.toBe(baseline.provenance);
  save(file, {
    ...original,
    expectations: { ...original.expectations, markerSlug: 'glucose' },
  });
  const matched = await run('labs-select-marker');
  expect(matched.evaluation).toBe('pass');
  expect(matched.observation).toEqual(changedResponse.observation);
});

test('D23 JSON loader rejects unregistered constraints and missing/unbounded evidence', () => {
  const file = 'labs-select-marker.json';
  const fixtureFile = 'fixtures/labs-select-marker-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  for (const mutate of [
    (value: typeof original) => {
      value.inputs.turns.pop();
    },
    (value: typeof original) => {
      value.inputs.turns.push(value.inputs.turns[0]);
    },
    (value: typeof original) => {
      value.inputs.turns[0].intent = '';
    },
    (value: typeof original) => {
      value.inputs.turns[0].command = 'execute';
    },
    (value: typeof original) => {
      value.expectations.action = 'showUpload';
    },
    (value: typeof original) => {
      value.expectations.markerSlug = 'cholesterol';
    },
    (value: typeof original) => {
      value.expectations.variant = 'list';
    },
    (value: typeof original) => {
      value.expectations.forbidNewInstances = false;
    },
    (value: typeof original) => {
      value.expectations.forbiddenActions = [];
    },
    (value: typeof original) => {
      value.expectations.scorer = 'module';
    },
    (value: typeof original) => {
      value.expectations.selectionTurn = 3;
    },
    (value: typeof original) => {
      value.oracle.id = 'legacy-weather-reuse';
    },
    (value: typeof original) => {
      value.fixtureId = 'labs-response';
    },
    (value: typeof original) => {
      value.lineage = value.lineage.map((entry: object) => ({
        ...entry,
        source: 'current',
      }));
    },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    save(file, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  for (const mutate of [
    (value: typeof fixture) => {
      value.kind = 'legacy-response-state';
    },
    (value: typeof fixture) => {
      value.data.responses.pop();
    },
    (value: typeof fixture) => {
      value.data.responses.push(value.data.responses[0]);
    },
    (value: typeof fixture) => {
      delete value.data.initial;
    },
    (value: typeof fixture) => {
      value.data.initial.layout.type = 'grid';
    },
    (value: typeof fixture) => {
      value.data.initial.layout.instances[0].variant = 'upload';
    },
    (value: typeof fixture) => {
      value.data.initial.layout.instances[0].vesselId = 'weather';
    },
    (value: typeof fixture) => {
      value.data.initial.layout.instances = [];
    },
    (value: typeof fixture) => {
      value.data.initial.layout.instances.push(
        value.data.initial.layout.instances[0],
      );
    },
    (value: typeof fixture) => {
      delete value.data.responses[1].layout;
    },
    (value: typeof fixture) => {
      delete value.data.responses[1].executionPlan;
    },
    (value: typeof fixture) => {
      value.data.responses[1].executionPlan[0].params.markerSlug = {
        nested: 'hemoglobin',
      };
    },
    (value: typeof fixture) => {
      value.data.responses[1].executionPlan[0].params.markerSlug = 'x'.repeat(
        1001,
      );
    },
    (value: typeof fixture) => {
      value.data.responses[1].executionPlan[0].params.command = 'execute';
    },
    (value: typeof fixture) => {
      value.data.responses[0].layout.type = 'unknown';
    },
    (value: typeof fixture) => {
      value.data.responses[0].layout.instances = Array(21).fill(
        value.data.initial.layout.instances[0],
      );
    },
    (value: typeof fixture) => {
      value.data.responses[1].executionPlan = Array(21).fill(
        value.data.responses[1].executionPlan[0],
      );
    },
  ]) {
    const changed = structuredClone(fixture);
    mutate(changed);
    save(fixtureFile, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('D24 JSON script, expectations and prompts drive independent observations and verdicts', async () => {
  const file = 'target-disambiguation.json';
  const fixtureFile = 'fixtures/target-disambiguation-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  expect(original).toMatchObject({
    profile: 'legacy-target-disambiguation',
    fixtureId: 'target-disambiguation-script',
    review: 'pending-human-review',
    migration: 'legacy-derived-harness',
    synthetic: true,
  });
  const baseline = await run('target-disambiguation');
  expect(baseline.evaluation).toBe('pass');
  for (const expectations of [
    { ...original.expectations, instanceId: 'other-weather' },
    {
      ...original.expectations,
      forbidActionsOn: ['other-calendar'],
      unchangedInstances: [{ instanceId: 'other-calendar', variant: 'month' }],
    },
  ]) {
    save(file, { ...original, expectations });
    const mismatch = await run('target-disambiguation');
    expect(mismatch.evaluation).toBe('fail');
    expect(mismatch.observation).toEqual(baseline.observation);
  }
  const request = structuredClone(original);
  request.inputs.turns[0].intent =
    'Synthetic request evidence, not interpreted';
  save(file, request);
  const changedRequest = await run('target-disambiguation');
  expect(changedRequest.evaluation).toBe('pass');
  expect(changedRequest.observation).toMatchObject([
    { input: { intent: request.inputs.turns[0].intent } },
    {},
    {},
    {},
  ]);
  save(file, original);
  const changed = structuredClone(fixture);
  changed.data.responses[2].layout.instances.pop();
  save(fixtureFile, changed);
  const lostCalendar = await run('target-disambiguation');
  expect(lostCalendar.evaluation).toBe('fail');
  expect(lostCalendar.provenance).not.toBe(baseline.provenance);
  expect(lostCalendar.observation).toMatchObject([
    {},
    {},
    { output: { layout: { instances: [{ instanceId: 'weather-main' }] } } },
    { state: { layout: { instances: [{ instanceId: 'weather-main' }] } } },
  ]);
  save(fixtureFile, fixture);
  for (const [id, profile, pointer] of [
    ['weather-reuse-weekly', 'legacy-weather-reuse', '/items/21'],
    ['labs-select-marker', 'legacy-labs-select-marker', '/items/22'],
    ['weather-chain', 'weather-session', '/items/30'],
  ]) {
    expect(json(`${id}.json`)).toMatchObject({
      profile,
      lineage: [{ pointer }],
    });
    expect((await run(id)).evaluation).toBe('pass');
  }
});

test('D24 loader rejects mismatched contracts, invalid initial states and incomplete/unbounded scripts', () => {
  const file = 'target-disambiguation.json';
  const fixtureFile = 'fixtures/target-disambiguation-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  for (const mutate of [
    (value: typeof original) => {
      value.inputs.turns.pop();
    },
    (value: typeof original) => {
      value.inputs.turns.push(value.inputs.turns[0]);
    },
    (value: typeof original) => {
      value.inputs.turns[0].intent = '';
    },
    (value: typeof original) => {
      value.inputs.turns[0].intent = 'x'.repeat(1001);
    },
    (value: typeof original) => {
      value.inputs.turns[0].command = 'execute';
    },
    (value: typeof original) => {
      value.expectations.action = 'showHourly';
    },
    (value: typeof original) => {
      value.expectations.variant = 'current';
    },
    (value: typeof original) => {
      value.expectations.forbidActionsOn = [];
    },
    (value: typeof original) => {
      value.expectations.forbidActionsOn = ['foreign'];
    },
    (value: typeof original) => {
      value.expectations.instanceId = 'calendar-main';
    },
    (value: typeof original) => {
      value.expectations.unchangedInstances[0].variant = 'week';
    },
    (value: typeof original) => {
      value.expectations.unchangedInstances = [];
    },
    (value: typeof original) => {
      value.expectations.forbidNewInstances = false;
    },
    (value: typeof original) => {
      value.expectations.scorer = 'module';
    },
    (value: typeof original) => {
      value.expectations.decisiveTurn = 3;
    },
    (value: typeof original) => {
      value.oracle.id = 'legacy-weather-reuse';
    },
    (value: typeof original) => {
      value.fixtureId = 'weather-reuse-script';
    },
    (value: typeof original) => {
      value.lineage = [];
    },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    save(file, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  for (const mutate of [
    (value: typeof fixture) => {
      value.kind = 'weather-reuse-script';
    },
    (value: typeof fixture) => {
      value.data.responses.pop();
    },
    (value: typeof fixture) => {
      value.data.responses.push(value.data.responses[0]);
    },
    (value: typeof fixture) => {
      delete value.data.initial;
    },
    (value: typeof fixture) => {
      value.data.initial.layout.type = 'grid';
    },
    (value: typeof fixture) => {
      value.data.initial.instances[0].variant = 'weekly';
    },
    (value: typeof fixture) => {
      value.data.initial.instances[1].vesselId = 'weather';
    },
    (value: typeof fixture) => {
      value.data.initial.instances[1].instanceId = 'weather-main';
    },
    (value: typeof fixture) => {
      value.data.initial.instances.pop();
    },
    (value: typeof fixture) => {
      value.data.initial.layout.instances[1] =
        value.data.initial.layout.instances[0];
    },
    (value: typeof fixture) => {
      value.data.initial.layout.instances[1].variant = 'week';
    },
    (value: typeof fixture) => {
      delete value.data.responses[2].layout;
    },
    (value: typeof fixture) => {
      delete value.data.responses[2].instances;
    },
    (value: typeof fixture) => {
      delete value.data.responses[2].executionPlan;
    },
    (value: typeof fixture) => {
      value.data.responses[2].layout.type = 'unknown';
    },
    (value: typeof fixture) => {
      value.data.responses[2].layout.instances = Array(21).fill(
        value.data.initial.instances[0],
      );
    },
    (value: typeof fixture) => {
      value.data.responses[2].instances = Array(21).fill(
        value.data.initial.instances[0],
      );
    },
    (value: typeof fixture) => {
      value.data.responses[2].executionPlan = Array(21).fill(
        value.data.responses[2].executionPlan[0],
      );
    },
    (value: typeof fixture) => {
      value.data.responses[2].executionPlan[0].action = 'x'.repeat(121);
    },
    (value: typeof fixture) => {
      value.data.responses[2].executionPlan[0].module = 'execute';
    },
  ]) {
    const changed = structuredClone(fixture);
    mutate(changed);
    save(fixtureFile, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('D32 loader rejects malformed/unbounded fixture evidence and unregistered profile constraints', () => {
  const file = 'weather-delayed-action.json';
  const fixtureFile = 'fixtures/weather-delayed-action-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  for (const mutate of [
    (value: typeof original) => {
      value.inputs.turns.pop();
    },
    (value: typeof original) => {
      value.inputs.turns.push(value.inputs.turns[0]);
    },
    (value: typeof original) => {
      value.inputs.turns[0].intent = '';
    },
    (value: typeof original) => {
      value.inputs.turns[0].command = 'execute';
    },
    (value: typeof original) => {
      value.expectations.action = 'invented';
    },
    (value: typeof original) => {
      value.expectations.variant = 'hourly';
    },
    (value: typeof original) => {
      value.expectations.forbidNewInstances = false;
    },
    (value: typeof original) => {
      value.expectations.scorer = 'module';
    },
    (value: typeof original) => {
      value.oracle.id = 'weather-transitions';
    },
    (value: typeof original) => {
      value.fixtureId = 'weather';
    },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    save(file, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  for (const mutate of [
    (value: typeof fixture) => {
      value.kind = 'weather-state';
    },
    (value: typeof fixture) => {
      value.data.responses.pop();
    },
    (value: typeof fixture) => {
      value.data.responses.push(value.data.responses[0]);
    },
    (value: typeof fixture) => {
      delete value.data.initial;
    },
    (value: typeof fixture) => {
      value.data.initial.instances[0].variant = 'weekly';
    },
    (value: typeof fixture) => {
      value.data.initial.instances.push(value.data.initial.instances[0]);
    },
    (value: typeof fixture) => {
      value.data.initial.layout.type = 'grid';
    },
    (value: typeof fixture) => {
      value.data.initial.layout.instances[0].instanceId = 'other';
    },
    (value: typeof fixture) => {
      delete value.data.responses[2].layout;
    },
    (value: typeof fixture) => {
      delete value.data.responses[1].executionPlan;
    },
    (value: typeof fixture) => {
      value.data.responses[0].executionPlan = Array(21).fill({
        instanceId: 'weather-main',
        action: 'showHourly',
      });
    },
    (value: typeof fixture) => {
      value.data.responses[0].instances = Array(21).fill(
        value.data.initial.instances[0],
      );
    },
    (value: typeof fixture) => {
      value.data.responses[0].layout.instances = Array(21).fill(
        value.data.initial.instances[0],
      );
    },
    (value: typeof fixture) => {
      value.data.responses[0].layout.type = 'unknown';
    },
    (value: typeof fixture) => {
      value.data.responses[0].layout.command = 'execute';
    },
  ]) {
    const changed = structuredClone(fixture);
    mutate(changed);
    save(fixtureFile, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('D32 JSON expectations never manufacture responses; scripts and requests remain independent', async () => {
  const file = 'weather-delayed-action.json';
  const fixtureFile = 'fixtures/weather-delayed-action-script.json';
  const original = json(file);
  const baseline = await run('weather-delayed-action');
  expect(baseline.evaluation).toBe('pass');
  const mismatch = structuredClone(original);
  mismatch.expectations.instanceId = 'other-weather';
  save(file, mismatch);
  const failed = await run('weather-delayed-action');
  expect(failed.evaluation).toBe('fail');
  expect(failed.observation).toEqual(baseline.observation);
  save(file, original);
  const fixture = json(fixtureFile);
  fixture.data.responses[2].executionPlan = [];
  save(fixtureFile, fixture);
  const noAction = await run('weather-delayed-action');
  expect(noAction.evaluation).toBe('fail');
  expect(noAction.observation).toMatchObject([
    {},
    {},
    { output: { executionPlan: [], instances: [{ variant: 'weekly' }] } },
  ]);
  expect(noAction.provenance).not.toBe(baseline.provenance);
  const request = structuredClone(original);
  request.inputs.turns[0].intent =
    'Synthetic request mutation, not interpreted';
  save(file, request);
  const changed = await run('weather-delayed-action');
  expect(changed.evaluation).toBe('fail');
  expect(changed.observation).toMatchObject([
    { input: request.inputs.turns[0] },
    {},
    { output: { executionPlan: [] } },
  ]);
});

test('D29 JSON expectations and response scripts remain independent', async () => {
  const original = await run('calendar-week-nav');
  expect(original.evaluation).toBe('pass');
  const file = 'calendar-week-nav.json';
  const definition = json(file);
  definition.expectations.instanceId = 'different-target';
  save(file, definition);
  const changed = await run('calendar-week-nav');
  expect(changed.evaluation).toBe('fail');
  expect(changed.observation).toEqual(original.observation);
  definition.expectations.instanceId = 'calendar-main';
  save(file, definition);
  const fixtureFile = 'fixtures/calendar-week-nav-script.json';
  const fixture = json(fixtureFile);
  fixture.data.responses[2].executionPlan[0].action = 'showMonth';
  save(fixtureFile, fixture);
  const mismatch = await run('calendar-week-nav');
  expect(mismatch.evaluation).toBe('fail');
  expect(mismatch.observation).toMatchObject([
    {},
    {},
    { output: { executionPlan: [{ action: 'showMonth' }] } },
  ]);
});

test('D29 profile and fixture schemas reject unknown configuration and malformed or unbounded scripts', () => {
  const file = 'calendar-week-nav.json';
  const original = json(file);
  for (const mutate of [
    (value: typeof original) => {
      value.inputs.module = './arbitrary.ts';
    },
    (value: typeof original) => {
      value.inputs.turns.pop();
    },
    (value: typeof original) => {
      value.inputs.turns.push(value.inputs.turns[0]);
    },
    (value: typeof original) => {
      value.expectations.command = 'run';
    },
    (value: typeof original) => {
      value.expectations.monthlyAction = 'showMonth';
    },
    (value: typeof original) => {
      value.expectations.weeklyVariant = 'weekly';
    },
    (value: typeof original) => {
      value.fixtureId = 'calendar-transitions';
    },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    save(file, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  const fixtureFile = 'fixtures/calendar-week-nav-script.json';
  const fixture = json(fixtureFile);
  for (const mutate of [
    (value: typeof fixture) => {
      value.data.url = 'https://example.invalid';
    },
    (value: typeof fixture) => {
      value.data.responses.pop();
    },
    (value: typeof fixture) => {
      value.data.responses.push(value.data.responses[0]);
    },
    (value: typeof fixture) => {
      delete value.data.responses[0].executionPlan;
    },
    (value: typeof fixture) => {
      delete value.data.responses[0].layout;
    },
    (value: typeof fixture) => {
      value.data.responses[0].layout.type = 'unknown';
    },
    (value: typeof fixture) => {
      value.data.responses[0].layout.instances = Array(21).fill(
        value.data.responses[0].layout.instances[0],
      );
    },
    (value: typeof fixture) => {
      value.data.responses[0].executionPlan = Array(21).fill(
        value.data.responses[0].executionPlan[0],
      );
    },
    (value: typeof fixture) => {
      value.data.responses[0].executionPlan[0].action = 'x'.repeat(121);
    },
    (value: typeof fixture) => {
      value.data.responses[0].executionPlan[0].module = './arbitrary.ts';
    },
    (value: typeof fixture) => {
      value.data.initial.layout.instances[0].variant = 'week';
    },
  ]) {
    const changed = structuredClone(fixture);
    mutate(changed);
    save(fixtureFile, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('D37 JSON prompt, independent expectations and current weighted-tree fixture drive evidence', async () => {
  const file = 'tiling-add-vessel.json';
  const fixtureFile = 'fixtures/tiling-add-vessel-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  expect(original).toMatchObject({
    synthetic: true,
    review: 'pending-human-review',
    migration: 'legacy-derived-harness',
    inputs: { intent: 'Add my calendar to the view too' },
    expectations: {
      addedInstance: {
        instanceId: 'calendar-added',
        vesselId: 'calendar',
        variant: 'month',
      },
    },
  });
  const baseline = await run('tiling-add-vessel');
  expect(baseline.evaluation).toBe('pass');
  original.expectations.addedInstance.instanceId = 'calendar-different';
  save(file, original);
  const changedExpectation = await run('tiling-add-vessel');
  expect(changedExpectation.evaluation).toBe('fail');
  expect(changedExpectation.observation).toEqual(baseline.observation);
  fixture.data.response.layout.instances[2].instanceId = 'calendar-different';
  fixture.data.response.layout.tree[3] = 'ID:calendar-different';
  save(fixtureFile, fixture);
  expect((await run('tiling-add-vessel')).evaluation).toBe('pass');
  fixture.data.response.layout.tree = ['ID:calendar-different'];
  save(fixtureFile, fixture);
  expect((await run('tiling-add-vessel')).evaluation).toBe('fail');
  original.inputs.intent = 'Changed synthetic request evidence';
  save(file, original);
  expect((await run('tiling-add-vessel')).observation).toMatchObject([
    {
      input: { intent: original.inputs.intent },
      output: { layout: { tree: ['ID:calendar-different'] } },
    },
  ]);
});

test('D37 fails closed on incompatible profile/fixture configuration and bounded raw-tree data', () => {
  const file = 'tiling-add-vessel.json';
  const fixtureFile = 'fixtures/tiling-add-vessel-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  for (const change of [
    { ...original, profile: 'dynamic-tree' },
    { ...original, oracle: { id: 'calendar-week-nav', version: 1 } },
    { ...original, fixtureId: 'weather' },
    { ...original, inputs: { ...original.inputs, module: 'arbitrary' } },
    { ...original, expectations: { ...original.expectations, heal: true } },
    {
      ...original,
      expectations: {
        ...original.expectations,
        addedInstance: {
          ...original.expectations.addedInstance,
          instanceId: 'weather-main',
        },
      },
    },
  ]) {
    save(file, change);
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  const mutations: ((value: typeof fixture) => void)[] = [
    (value) => {
      value.data.registeredVessels = ['weather', 'labs'];
    },
    (value) => {
      value.data.initial.layout.tree = ['ID:weather-main'];
    },
    (value) => {
      value.data.initial.layout.tree = [
        'V:0,1',
        'ID:weather-main',
        'ID:labs-main',
      ];
    },
    (value) => {
      value.data.initial.layout.instances[0].variant = 'weekly';
    },
    (value) => {
      value.data.initial.layout.instances.push(
        value.data.initial.layout.instances[0],
      );
    },
    (value) => {
      delete value.data.response;
    },
    (value) => {
      delete value.data.response.layout.tree;
    },
    (value) => {
      value.data.response.layout.tree = Array(257).fill(null);
    },
    (value) => {
      value.data.response.layout.tree = ['x'.repeat(257)];
    },
    (value) => {
      value.data.response.layout.tree = [['V', 'ID:weather-main']];
    },
    (value) => {
      value.data.response.layout.instances = Array(21).fill(
        value.data.response.layout.instances[0],
      );
    },
    (value) => {
      value.data.response.executionPlan = Array(21).fill({
        instanceId: 'weather-main',
        action: 'showWeekly',
      });
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(fixture);
    mutate(changed);
    save(fixtureFile, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('D12 JSON observations are independent from expectations and remain separate from D37', async () => {
  const file = 'tiling-tree-validity.json';
  const fixtureFile = 'fixtures/tiling-tree-validity-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  const previousCase = json('tiling-add-vessel.json');
  const previousFixture = json('fixtures/tiling-add-vessel-script.json');
  expect(original).toMatchObject({
    profile: 'legacy-tiling-tree-validity',
    synthetic: true,
    review: 'pending-human-review',
    migration: 'legacy-derived-harness',
    inputs: { intent: 'Add my lab results to the view' },
    expectations: {
      retainedInstance: {
        instanceId: 'weather-main',
        vesselId: 'weather',
        variant: 'current',
      },
      addedInstance: {
        instanceId: 'labs-main',
        vesselId: 'labs',
        variant: 'trends',
      },
    },
  });
  const baseline = await run('tiling-tree-validity');
  expect(baseline.evaluation).toBe('pass');
  original.expectations.addedInstance.instanceId = 'labs-other';
  save(file, original);
  const different = await run('tiling-tree-validity');
  expect(different.evaluation).toBe('fail');
  expect(different.observation).toEqual(baseline.observation);
  fixture.data.response.layout.instances[1].instanceId = 'labs-other';
  fixture.data.response.layout.tree[2] = 'ID:labs-other';
  save(fixtureFile, fixture);
  expect((await run('tiling-tree-validity')).evaluation).toBe('pass');
  fixture.data.response.layout.tree = [
    'V:1,1,1',
    'ID:weather-main',
    'ID:labs-other',
    null,
  ];
  save(fixtureFile, fixture);
  expect((await run('tiling-tree-validity')).evaluation).toBe('fail');
  original.inputs.intent = 'Changed synthetic request';
  save(file, original);
  expect((await run('tiling-tree-validity')).observation).toMatchObject([
    {
      input: { intent: original.inputs.intent },
      output: { layout: { tree: fixture.data.response.layout.tree } },
    },
  ]);
  expect(json('tiling-add-vessel.json')).toEqual(previousCase);
  expect(json('fixtures/tiling-add-vessel-script.json')).toEqual(
    previousFixture,
  );
  expect((await run('tiling-add-vessel')).evaluation).toBe('pass');
});

test('D12 rejects unregistered profiles, incompatible contracts and malformed or oversized fixture evidence', () => {
  const file = 'tiling-tree-validity.json';
  const fixtureFile = 'fixtures/tiling-tree-validity-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  for (const change of [
    { ...original, profile: 'dynamic-binary-tree' },
    { ...original, oracle: { id: 'legacy-tiling-add-vessel', version: 1 } },
    { ...original, fixtureId: 'tiling-add-vessel-script' },
    { ...original, inputs: { ...original.inputs, module: 'arbitrary' } },
    { ...original, expectations: { ...original.expectations, heal: true } },
    {
      ...original,
      expectations: {
        ...original.expectations,
        addedInstance: {
          ...original.expectations.addedInstance,
          instanceId: 'weather-main',
        },
      },
    },
  ]) {
    save(file, change);
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  const mutations: ((value: typeof fixture) => void)[] = [
    (value) => {
      value.kind = 'tiling-add-vessel-script';
    },
    (value) => {
      value.data.registeredVessels = ['weather'];
    },
    (value) => {
      value.data.initial.layout.tree = [null];
    },
    (value) => {
      value.data.initial.layout.tree = [
        'V:1,1,1',
        'ID:weather-main',
        null,
        null,
      ];
    },
    (value) => {
      value.data.initial.layout.tree = ['H:0,1', 'ID:weather-main', null];
    },
    (value) => {
      value.data.initial.layout.instances[0].variant = 'weekly';
    },
    (value) => {
      value.data.initial.layout.instances.push(
        value.data.initial.layout.instances[0],
      );
    },
    (value) => {
      delete value.data.response;
    },
    (value) => {
      delete value.data.response.layout.tree;
    },
    (value) => {
      value.data.response.layout.tree = Array(257).fill(null);
    },
    (value) => {
      value.data.response.layout.tree = ['x'.repeat(257)];
    },
    (value) => {
      value.data.response.layout.tree = [
        ['V', 'ID:weather-main', 'ID:labs-main'],
      ];
    },
    (value) => {
      value.data.response.layout.instances = Array(21).fill(
        value.data.response.layout.instances[0],
      );
    },
    (value) => {
      value.data.response.executionPlan = Array(21).fill({
        instanceId: 'weather-main',
        action: 'unscored',
      });
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(fixture);
    mutate(changed);
    save(fixtureFile, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('D13 JSON drives a dedicated grid verdict independently of responses, prompts and Chart expectations', async () => {
  const file = 'grid-no-overlap.json';
  const fixtureFile = 'fixtures/grid-no-overlap-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  expect(original).toMatchObject({
    profile: 'legacy-grid-no-overlap',
    synthetic: true,
    review: 'pending-human-review',
    migration: 'legacy-derived-harness',
    inputs: { intent: 'Place 5 vessels in compact grid' },
    expectations: {
      chartDimensions: { rows: 12, columns: 16 },
      instanceIds: [
        'weather-main',
        'labs-main',
        'calendar-main',
        'email-main',
        'tasks-main',
      ],
    },
  });
  expect(fixture.data.initial.layout.positions[1].size).toEqual({
    width: 8,
    height: 4,
  });
  const baseline = await run('grid-no-overlap');
  expect(baseline.evaluation).toBe('pass');
  const changed = structuredClone(original);
  changed.expectations.instanceIds[0] = 'other-weather';
  save(file, changed);
  const identities = await run('grid-no-overlap');
  expect(identities.evaluation).toBe('fail');
  expect(identities.observation).toEqual(baseline.observation);
  changed.expectations = structuredClone(original.expectations);
  changed.expectations.chartDimensions.rows = 11;
  save(file, changed);
  const bounds = await run('grid-no-overlap');
  expect(bounds.evaluation).toBe('fail');
  expect(bounds.observation).toEqual(baseline.observation);
  save(file, original);
  fixture.data.response.layout.positions[1].position.column = 7;
  save(fixtureFile, fixture);
  const overlap = await run('grid-no-overlap');
  expect(overlap.evaluation).toBe('fail');
  expect(overlap.failures).toContain('Response: Grid positions overlap');
  fixture.data.response.layout.positions[1].position.column = 8;
  fixture.data.chartDimensions.rows = 13;
  fixture.data.response.layout.positions[4].size.height = 5;
  changed.expectations.chartDimensions.rows = 13;
  changed.inputs.intent = 'Changed synthetic request';
  save(file, changed);
  save(fixtureFile, fixture);
  const resized = await run('grid-no-overlap');
  expect(resized.evaluation).toBe('pass');
  expect(resized.observation).toMatchObject([
    {
      input: { intent: changed.inputs.intent },
      output: { layout: fixture.data.response.layout },
    },
  ]);
});

test('D13 rejects unregistered composition, incompatible context, malformed and oversized evidence', () => {
  const file = 'grid-no-overlap.json';
  const fixtureFile = 'fixtures/grid-no-overlap-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  for (const change of [
    { ...original, profile: 'dynamic-grid' },
    { ...original, oracle: { id: 'legacy-tiling-tree-validity', version: 1 } },
    { ...original, fixtureId: 'tiling-tree-validity-script' },
    { ...original, inputs: { ...original.inputs, module: 'arbitrary' } },
    {
      ...original,
      expectations: { ...original.expectations, scoreCompactness: true },
    },
    {
      ...original,
      expectations: {
        ...original.expectations,
        instanceIds: Array(5).fill('duplicate'),
      },
    },
    {
      ...original,
      expectations: {
        ...original.expectations,
        chartDimensions: { rows: 12, columns: -1 },
      },
    },
  ]) {
    save(file, change);
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  const mutations: ((value: typeof fixture) => void)[] = [
    (value) => {
      value.kind = 'tiling-tree-validity-script';
    },
    (value) => {
      delete value.data.chartDimensions;
    },
    (value) => {
      value.data.chartDimensions.rows = 0;
    },
    (value) => {
      value.data.chartDimensions.rows = 1.5;
    },
    (value) => {
      value.data.chartDimensions.columns = 1001;
    },
    (value) => {
      value.data.chartDimensions.viewport = true;
    },
    (value) => {
      value.data.instances.pop();
    },
    (value) => {
      value.data.instances[1].instanceId = value.data.instances[0].instanceId;
    },
    (value) => {
      value.data.instances[1].variant = 'upload';
    },
    (value) => {
      value.data.initial.layout.positions[1].position.column = 7;
    },
    (value) => {
      value.data.initial.layout.positions.pop();
    },
    (value) => {
      value.data.initial.layout.positions[1].size.height = 0;
    },
    (value) => {
      delete value.data.response;
    },
    (value) => {
      delete value.data.response.layout.positions;
    },
    (value) => {
      value.data.response.layout.positions = Array(21).fill(
        value.data.response.layout.positions[0],
      );
    },
    (value) => {
      value.data.response.layout.positions[0].size.width = 1_000_001;
    },
    (value) => {
      value.data.response.layout.positions[0].position.row = '0';
    },
    (value) => {
      value.data.response.layout.positions[0].size.pixels = 20;
    },
    (value) => {
      value.data.response.executionPlan = Array(21).fill({
        instanceId: 'weather-main',
        action: 'unscored',
      });
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(fixture);
    mutate(changed);
    save(fixtureFile, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('D30 JSON responses and expectations stay independent under the fixed exact-set contract', async () => {
  const file = 'labs-multi-marker-final.json';
  const fixtureFile = 'fixtures/labs-multi-marker-final-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  const baseline = await run('labs-multi-marker-final');
  expect(baseline.evaluation).toBe('pass');
  const reordered = structuredClone(original);
  reordered.expectations.markerSlugs.reverse();
  save(file, reordered);
  const changedExpectation = await run('labs-multi-marker-final');
  expect(changedExpectation.evaluation).toBe('pass');
  expect(changedExpectation.observation).toEqual(baseline.observation);
  expect(changedExpectation.provenance).not.toBe(baseline.provenance);
  fixture.data.responses[2].executionPlan[0].params.markerSlugs = ['glucose'];
  save(fixtureFile, fixture);
  const missing = await run('labs-multi-marker-final');
  expect(missing.evaluation).toBe('fail');
  expect(missing.observation).toMatchObject([
    {},
    {},
    { output: { executionPlan: [{ params: { markerSlugs: ['glucose'] } }] } },
  ]);
  save(file, original);
  const unchanged = await run('labs-multi-marker-final');
  expect(unchanged.evaluation).toBe('fail');
  expect(unchanged.observation).toEqual(missing.observation);
});

test('D30 JSON loader rejects incompatible profiles, weakened expectations and incomplete scripts', () => {
  const file = 'labs-multi-marker-final.json';
  const fixtureFile = 'fixtures/labs-multi-marker-final-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  for (const change of [
    { oracle: { id: 'legacy-labs-select-marker', version: 1 } },
    { fixtureId: 'labs-select-marker-script' },
    { inputs: { turns: original.inputs.turns.slice(0, 2) } },
    { inputs: { turns: [...original.inputs.turns, original.inputs.turns[2]] } },
    { expectations: { ...original.expectations, markerSlugs: ['glucose'] } },
    { expectations: { ...original.expectations, turnIndex: 1 } },
    { lineage: [] },
  ]) {
    save(file, { ...original, ...change });
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  for (const data of [
    { responses: fixture.data.responses },
    { ...fixture.data, responses: fixture.data.responses.slice(0, 2) },
    {
      ...fixture.data,
      responses: [...fixture.data.responses, fixture.data.responses[2]],
    },
    { ...fixture.data, unexpected: true },
    { ...fixture.data, responses: [{}, ...fixture.data.responses.slice(1)] },
  ]) {
    save(fixtureFile, { ...fixture, data });
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('D34 JSON requests, expected identities and scripts drive observations and verdicts independently', async () => {
  const file = 'multivessel-add-instance.json';
  const fixtureFile = 'fixtures/multivessel-add-instance-script.json';
  const original = json(file);
  const baseline = await run('multivessel-add-instance');
  expect(baseline.evaluation).toBe('pass');
  const requests = structuredClone(original);
  requests.inputs.turns[0].intent = 'Synthetic changed request';
  save(file, requests);
  const changedRequest = await run('multivessel-add-instance');
  expect(changedRequest.evaluation).toBe('pass');
  expect(changedRequest.observation).toMatchObject([
    { input: { intent: 'Synthetic changed request' } },
    {},
  ]);
  expect(changedRequest.provenance).not.toBe(baseline.provenance);
  const changedExpected = structuredClone(original);
  changedExpected.expectations.addedInstance.instanceId = 'different-calendar';
  save(file, changedExpected);
  const expectedFailure = await run('multivessel-add-instance');
  expect(expectedFailure.evaluation).toBe('fail');
  expect(expectedFailure.observation).toEqual(baseline.observation);
  save(file, original);
  const fixture = json(fixtureFile);
  fixture.data.responses[0].executionPlan = [];
  save(fixtureFile, fixture);
  const missingTarget = await run('multivessel-add-instance');
  expect(missingTarget.evaluation).toBe('fail');
  expect(missingTarget.observation).toMatchObject([
    { output: { executionPlan: [] } },
    {},
  ]);
  expect(missingTarget.provenance).not.toBe(baseline.provenance);
});

test('D34 strict profile, fixture and identity schemas fail closed before execution', () => {
  const file = 'multivessel-add-instance.json';
  const fixtureFile = 'fixtures/multivessel-add-instance-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  for (const change of [
    (value: typeof original) => {
      value.profile = 'unregistered-add-instance';
    },
    (value: typeof original) => {
      value.oracle.version = 2;
    },
    (value: typeof original) => {
      value.inputs.turns.pop();
    },
    (value: typeof original) => {
      value.inputs.turns.push(value.inputs.turns[0]);
    },
    (value: typeof original) => {
      value.expectations.addedInstance.instanceId = 'weather-main';
    },
    (value: typeof original) => {
      value.expectations.addedInstance.finalVariant = 'week';
    },
    (value: typeof original) => {
      value.expectations.retainedInstance.variant = 'weekly';
    },
    (value: typeof original) => {
      value.expectations.executeActions = true;
    },
  ]) {
    const invalid = structuredClone(original);
    change(invalid);
    save(file, invalid);
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  for (const change of [
    (value: typeof fixture) => {
      value.kind = 'weather-reuse-script';
    },
    (value: typeof fixture) => {
      value.data.initial.layout.instances = [];
    },
    (value: typeof fixture) => {
      value.data.initial.layout.instances.push(
        value.data.responses[0].layout.instances[1],
      );
    },
    (value: typeof fixture) => {
      value.data.registeredVessels.pop();
    },
    (value: typeof fixture) => {
      value.data.responses.pop();
    },
    (value: typeof fixture) => {
      value.data.responses[0].executionPlan[0].execute = 'command';
    },
    (value: typeof fixture) => {
      value.data.responses[0].executionPlan = Array(21).fill(
        value.data.responses[0].executionPlan[0],
      );
    },
  ]) {
    const invalid = structuredClone(fixture);
    change(invalid);
    save(fixtureFile, invalid);
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('D36 JSON prompts, Labs expectations and response scripts independently change evidence/verdicts', async () => {
  const file = 'cross-vessel.json';
  const fixtureFile = 'fixtures/cross-vessel-script.json';
  const original = json(file);
  expect(original).toMatchObject({
    synthetic: true,
    review: 'pending-human-review',
    migration: 'legacy-derived-harness',
    inputs: {
      turns: [
        { intent: 'Show me the hourly weather.' },
        { intent: 'Now show me my lab results.' },
        { intent: 'Switch the weather to weekly without touching labs.' },
      ],
    },
    expectations: {
      labs: {
        instanceId: 'labs-main',
        vesselId: 'lab-results',
        variant: 'trends',
      },
    },
  });
  const baseline = await run('cross-vessel');
  expect(baseline.evaluation).toBe('pass');
  const changed = structuredClone(original);
  changed.inputs.turns[1].intent = 'Synthetic changed request';
  save(file, changed);
  const request = await run('cross-vessel');
  expect(request.evaluation).toBe('pass');
  expect(request.observation).toMatchObject([
    {},
    { input: { intent: 'Synthetic changed request' } },
    {},
  ]);
  expect(request.provenance).not.toBe(baseline.provenance);
  const mismatch = structuredClone(original);
  mismatch.expectations.labs.instanceId = 'lab-results-main';
  save(file, mismatch);
  const expectedFailure = await run('cross-vessel');
  expect(expectedFailure.evaluation).toBe('fail');
  expect(expectedFailure.observation).toEqual(baseline.observation);
  save(file, original);
  const fixture = json(fixtureFile);
  fixture.data.responses[1].layout.instances[2].variant = 'summary';
  save(fixtureFile, fixture);
  const wrongVariant = await run('cross-vessel');
  expect(wrongVariant.evaluation).toBe('fail');
  expect(wrongVariant.observation).toMatchObject([
    {},
    { output: { layout: { instances: [{}, {}, { variant: 'summary' }] } } },
    {},
  ]);
  expect(wrongVariant.provenance).not.toBe(baseline.provenance);
});

test('D36 rejects incompatible profiles, weakened constraints, preloaded Labs and incomplete scripts', () => {
  const file = 'cross-vessel.json';
  const fixtureFile = 'fixtures/cross-vessel-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  for (const change of [
    (value: typeof original) => {
      value.profile = 'unregistered-cross-vessel';
    },
    (value: typeof original) => {
      value.oracle.version = 2;
    },
    (value: typeof original) => {
      value.fixtureId = 'target-disambiguation-script';
    },
    (value: typeof original) => {
      value.inputs.turns.pop();
    },
    (value: typeof original) => {
      value.inputs.turns.push(value.inputs.turns[0]);
    },
    (value: typeof original) => {
      value.expectations.labs.instanceId = 'weather-main';
    },
    (value: typeof original) => {
      value.expectations.labs.vesselId = 'labs';
    },
    (value: typeof original) => {
      value.expectations.labs.variant = 'summary';
    },
    (value: typeof original) => {
      value.expectations.weather.finalAction = 'showHourly';
    },
    (value: typeof original) => {
      value.expectations.calendar.variant = 'week';
    },
    (value: typeof original) => {
      value.expectations.executeActions = true;
    },
    (value: typeof original) => {
      value.lineage = [];
    },
  ]) {
    const invalid = structuredClone(original);
    change(invalid);
    save(file, invalid);
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  for (const change of [
    (value: typeof fixture) => {
      value.kind = 'target-disambiguation-script';
    },
    (value: typeof fixture) => {
      value.data.registeredVessels[2] = 'labs';
    },
    (value: typeof fixture) => {
      value.data.initial.layout.instances.push(original.expectations.labs);
    },
    (value: typeof fixture) => {
      value.data.initial.layout.instances[0].variant = 'hourly';
    },
    (value: typeof fixture) => {
      value.data.responses.pop();
    },
    (value: typeof fixture) => {
      value.data.responses.push(value.data.responses[0]);
    },
    (value: typeof fixture) => {
      value.data.responses[0].executionPlan = Array(21).fill(
        value.data.responses[0].executionPlan[0],
      );
    },
    (value: typeof fixture) => {
      value.data.responses[0].executionPlan[0].command = 'execute';
    },
  ]) {
    const invalid = structuredClone(fixture);
    change(invalid);
    save(fixtureFile, invalid);
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('D17 JSON script remains independent of the code-owned target-exclusion predicate', async () => {
  const file = 'no-dual-target-plan.json';
  const fixtureFile = 'fixtures/no-dual-target-plan-script.json';
  const original = json(file);
  const fixture = json(fixtureFile);
  expect((await run('no-dual-target-plan')).evaluation).toBe('pass');
  fixture.data.response.executionPlan = [
    { instanceId: 'calendar-main', action: 'anything' },
    { instanceId: 'weather-main', action: 'anything' },
  ];
  fixture.data.response.assistantText = 'Which weekly view?';
  save(fixtureFile, fixture);
  const dual = await run('no-dual-target-plan');
  expect(dual.evaluation).toBe('fail');
  expect(dual.observation).toMatchObject([{ output: fixture.data.response }]);
  save(file, {
    ...original,
    inputs: { intent: 'A different synthetic prompt' },
  });
  const changed = await run('no-dual-target-plan');
  expect(changed.evaluation).toBe('fail');
  expect(changed.observation).toMatchObject([
    {
      input: { intent: 'A different synthetic prompt' },
      output: fixture.data.response,
    },
  ]);
});

test('D17 loader rejects missing/malformed response projections and configurable target or clarification rules', () => {
  const file = 'no-dual-target-plan.json';
  const original = json(file);
  for (const change of [
    { expectations: { rule: 'clarification' } },
    { expectations: { rule: 'no-dual-target-plan', targets: ['other'] } },
    { expectations: { rule: 'no-dual-target-plan', requireQuestion: true } },
    { fixtureId: 'weather-response' },
    { oracle: { id: 'legacy-response-constraint', version: 1 } },
    { lineage: [] },
  ]) {
    save(file, { ...original, ...change });
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  const fixtureFile = 'fixtures/no-dual-target-plan-script.json';
  const fixture = json(fixtureFile);
  for (const response of [
    {},
    { assistantText: 'Which view?' },
    { assistantText: '', executionPlan: null },
    { assistantText: '', executionPlan: [{ instanceId: 3, action: 'any' }] },
    {
      assistantText: '',
      executionPlan: Array(21).fill({
        instanceId: 'weather-main',
        action: 'any',
      }),
    },
    { assistantText: 'x'.repeat(2001), executionPlan: [] },
  ]) {
    save(fixtureFile, { ...fixture, data: { ...fixture.data, response } });
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('scripted variant candidate JSON drives shipped evidence while expectations come from canonical JSON', async () => {
  const file = 'fixtures/variant-candidate.json';
  const original = json(file);
  const baseline = await run('scripted-variant');
  expect(baseline.evaluation).toBe('pass');
  const reference = scenarios.find((item) => item.id === 'variant');
  const expected = structuredClone(reference?.expected);
  const missingAction = structuredClone(original);
  missingAction.data.candidate.executionPlan = [];
  save(file, missingAction);
  const failed = await run('scripted-variant');
  expect(failed.execution).toBe('completed');
  expect(failed.evaluation).toBe('fail');
  expect(failed.observation).toMatchObject({
    executionPlan: [],
    score: { pass: false },
  });
  expect(failed.records[0].value).toEqual(missingAction.data);
  expect(failed.provenance).not.toBe(baseline.provenance);
  const healable = structuredClone(original);
  healable.data.candidate.executionPlan.push({
    instanceId: 'weather-main',
    action: 'inventedAction',
  });
  save(file, healable);
  const healed = await run('scripted-variant');
  expect(healed.evaluation).toBe('pass');
  expect(healed.records[0].value).toEqual(healable.data);
  expect(healed.observation).toMatchObject({
    executionPlan: original.data.candidate.executionPlan,
  });
  expect(reference?.expected).toEqual(expected);
});

test('scripted-candidate profile permits only the validated JSON variant snapshot and bounded tiling candidate', () => {
  const file = 'scripted-variant.json';
  const original = json(file);
  for (const changed of [
    { ...original, scenarioId: 'preserve' },
    { ...original, lineage: [] },
    { ...original, expectations: { source: 'scenario', actions: [] } },
    { ...original, inputs: { response: 'preserve' } },
    { ...original, migration: 'composed-harness' },
    { ...original, oracle: { id: 'custom-score', version: 1 } },
    { ...original, profile: 'remote-candidate' },
  ]) {
    save(file, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
  save(file, original);
  const fixtureFile = 'fixtures/variant-candidate.json';
  const fixture = json(fixtureFile);
  for (const changed of [
    { ...fixture, kind: 'planner-script' },
    { ...fixture, data: {} },
    { ...fixture, data: { ...fixture.data, module: 'remote' } },
    {
      ...fixture,
      data: {
        candidate: { ...fixture.data.candidate, layout: { positions: [] } },
      },
    },
  ]) {
    save(fixtureFile, changed);
    expect(() => loadOfflineCases(root)).toThrow();
  }
});

test('JSON variant request/catalog and expectations drive offline execution independently of registry and candidate', async () => {
  const file = 'scripted-variant.json';
  const original = json(file);
  const candidate = json('fixtures/variant-candidate.json');
  const registry = structuredClone(
    scenarios.find((item) => item.id === 'variant'),
  );
  expect((await run('scripted-variant')).evaluation).toBe('pass');

  const expectedHourly = structuredClone(original);
  expectedHourly.expectations.actions[0].action = 'showHourly';
  save(file, expectedHourly);
  const wrongExpectation = await run('scripted-variant');
  expect(wrongExpectation.evaluation).toBe('fail');
  expect(
    wrongExpectation.failures.some((failure) =>
      failure.startsWith('Ordered actions:'),
    ),
  ).toBe(true);
  expect(wrongExpectation.records[0].value).toEqual(candidate.data);

  const changedCatalog = structuredClone(original);
  const weather = changedCatalog.inputs.request.vessels.find(
    (vessel: { id: string }) => vessel.id === 'weather',
  );
  weather.variants.current.actions = weather.variants.current.actions.filter(
    (action: { name: string }) => action.name !== 'showWeekly',
  );
  save(file, changedCatalog);
  const unavailableAction = await run('scripted-variant');
  expect(unavailableAction.evaluation).toBe('fail');
  expect(unavailableAction.observation).toMatchObject({ executionPlan: [] });
  expect(unavailableAction.records[0].value).toEqual(candidate.data);

  expect(scenarios.find((item) => item.id === 'variant')).toEqual(registry);
  expect(json('fixtures/variant-candidate.json')).toEqual(candidate);
});

test('planner JSON snapshots drive offline request/history and expectations, not the global registry', async () => {
  const registry = structuredClone(scenarios);
  const fixture = json('fixtures/planner-script.json');
  for (const [caseId, id] of [
    ['planner-preserve', 'preserve'],
    ['planner-deferral', 'generate-content'],
  ]) {
    const file = `${caseId}.json`;
    const data = json(file);
    expect((await run(caseId)).evaluation).toBe('pass');
    data.inputs.request.context.updateReasons[0].intent =
      'Edited offline intent';
    data.inputs.request.context.chartDimensions.columns = 32;
    data.inputs.request.vessels[0].description = 'Edited offline catalog';
    data.inputs.history = [
      { role: 'assistant', content: 'Edited offline history' },
    ];
    data.inputs.request.layout.tree = [
      'V',
      'ID:weather-main',
      'ID:calendar-main',
    ];
    if (id === 'preserve')
      data.expectations.visible = ['weather-main', 'calendar-main'];
    save(file, data);
    const plannerCall = spyOn(runtimeFixtures, 'planner');
    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run(caseId);
      expect(plannerCall).toHaveBeenCalledTimes(1);
      expect(plannerCall.mock.calls[0][3]).toMatchObject({
        request: data.inputs.request,
        history: data.inputs.history,
        expected: data.expectations,
      });
    } finally {
      plannerCall.mockRestore();
    }
    expect(result.evaluation).toBe('pass');
    expect(result.observation).toMatchObject({
      tree: data.inputs.request.layout.tree,
      instances: data.inputs.request.instances,
      userMessage: fixture.data.userMessage,
    });
    expect(scenarios).toEqual(registry);
    expect(json('fixtures/planner-script.json')).toEqual(fixture);
  }
});

test('planner fixture selection and request-derived output remain independent of canonical expectations', async () => {
  const preserveFile = 'planner-preserve.json';
  const original = json(preserveFile);
  const baseline = await run('planner-preserve');
  expect(baseline.evaluation).toBe('pass');
  for (const expectations of [
    { ...original.expectations, visible: ['weather-main'] },
    {
      ...original.expectations,
      actions: [{ instanceId: 'weather-main', action: 'showWeekly' }],
    },
  ]) {
    save(preserveFile, { ...original, expectations });
    const failed = await run('planner-preserve');
    expect(failed.evaluation).toBe('fail');
    expect(failed.observation).toMatchObject({
      tree: original.inputs.request.layout.tree,
      executionPlan: [],
      instances: original.inputs.request.instances,
    });
  }
  // The existing reference tree is not a scored target or a mocked response template.
  save(preserveFile, {
    ...original,
    expectations: { ...original.expectations, tree: ['ID:journal-main'] },
  });
  const referenceOnly = await run('planner-preserve');
  expect(referenceOnly.evaluation).toBe('pass');
  expect(referenceOnly.observation).toMatchObject({
    tree: original.inputs.request.layout.tree,
  });

  save(preserveFile, original);
  const deferFile = 'planner-deferral.json';
  const deferral = json(deferFile);
  expect((await run('planner-deferral')).evaluation).toBe('pass');
  deferral.inputs.response = 'preserve';
  save(deferFile, deferral);
  const noDeferral = await run('planner-deferral');
  expect(noDeferral.evaluation).toBe('fail');
  expect(noDeferral.observation).toMatchObject({
    expectedDeferral: true,
    deferredAsExpected: false,
  });
  expect(noDeferral.failures).toEqual([
    'Expected planner deferral was not observed',
  ]);

  original.inputs.response = 'defer';
  save(preserveFile, original);
  const unexpectedDeferral = await run('planner-preserve');
  expect(unexpectedDeferral.disposition).toBe('deferred');
  expect(unexpectedDeferral.observation).toMatchObject({
    expectedDeferral: false,
  });
  expect(json('fixtures/planner-script.json').data).toEqual({
    userMessage: 'Unchanged',
    rationale: 'Keep synthetic layout',
  });
});

test('planner source cases reject conflicting contracts while replay cases remain reference controls', async () => {
  for (const caseId of ['planner-preserve', 'planner-deferral']) {
    const file = `${caseId}.json`;
    const original = json(file);
    for (const changed of [
      { ...original, migration: 'reference-backed' },
      { ...original, expectations: { source: 'scenario' } },
      { ...original, inputs: { response: original.inputs.response } },
      { ...original, scenarioId: 'variant' },
      { ...original, expectations: { ...original.expectations, retained: [] } },
    ]) {
      save(file, changed);
      expect(() => loadOfflineCases(root)).toThrow();
    }
    save(file, original);
  }
  for (const id of ['replay-compatible', 'replay-incompatible']) {
    expect(json(`${id}.json`).migration).toBe('reference-backed');
    expect(json(`${id}.json`).expectations).toEqual({ source: 'scenario' });
  }
  expect((await run('replay-compatible')).evaluation).toBe('pass');
  const incompatible = await run('replay-incompatible');
  expect(incompatible.execution).toBe('invalid');
  expect(incompatible.evaluation).toBe('unscored');
  expect(incompatible.records).toEqual([]);
});
