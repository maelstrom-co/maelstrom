import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  buildLegacyAccounting,
  legacyObligationsSchema,
  legacySourceDigest,
  loadLegacyObligations,
} from '../../packages/evals/src/core/legacy-obligations.js';
import {
  jsonBackedScenarioIds,
  scenarios,
} from '../../packages/evals/src/core/scenarios.js';
import { loadOfflineCases } from './cases.js';
import { buildInventoryReport } from './inventory.js';

let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in source obligation inventory');
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
function document() {
  return JSON.parse(
    readFileSync(
      new URL(
        '../../packages/evals/obligations/v1/legacy.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
}

test('all 41 pinned pointers are accounted separately from executable case and scenario counts', () => {
  const cases = loadOfflineCases();
  const ledger = loadLegacyObligations();
  const accounting = buildLegacyAccounting(cases, ledger);
  expect(accounting.counts).toEqual({
    sourceRows: 41,
    rowsWithBoundedCaseEvidence: 32,
    rowsWithBoundedCodeUnitEvidence: 1,
    sourceOnlyBlockedObligations: 0,
    outOfScopeObligations: 8,
    accountedRows: 41,
    unaccountedRows: 0,
  });
  expect(
    accounting.sourceOnlyBlockedObligations.map((row) => row.pointer),
  ).toEqual([]);
  expect(accounting.outOfScopeObligations.map((row) => row.pointer)).toEqual(
    Array.from({ length: 8 }, (_, i) => `/items/${i + 3}`),
  );
  expect(
    accounting.rowsWithBoundedCaseEvidence.filter((row) =>
      [37, 38, 39, 40].some((i) => row.pointer === `/items/${i}`),
    ),
  ).toHaveLength(4);
  expect(
    accounting.rowsWithBoundedCodeUnitEvidence.map((row) => row.pointer),
  ).toEqual(['/items/0']);
  expect(
    accounting.rowsWithBoundedCaseEvidence.find(
      (row) => row.pointer === '/items/35',
    )?.caseIds,
  ).toEqual(['cross-vessel']);
  expect(
    accounting.rowsWithBoundedCaseEvidence.find(
      (row) => row.pointer === '/items/32',
    )?.caseIds,
  ).toHaveLength(3);
  expect(
    new Set(
      [
        ...accounting.rowsWithBoundedCaseEvidence,
        ...accounting.rowsWithBoundedCodeUnitEvidence,
        ...accounting.sourceOnlyBlockedObligations,
        ...accounting.outOfScopeObligations,
      ].map((row) => row.pointer),
    ).size,
  ).toBe(41);
  const report = buildInventoryReport(scenarios, cases, jsonBackedScenarioIds);
  expect(report.counts).toEqual({
    currentScenarios: 155,
    jsonBackedScenarios: 155,
    typescriptBackedNotYetJsonSnapshottedScenarios: 0,
    cases: 43,
    fixtures: 35,
    uniqueProfiles: 30,
    caseScenarioReferences: 8,
    linkedCurrentScenarios: 5,
  });
  expect(report.currentScenarioIdsWithoutCaseLink).toHaveLength(150);
  expect(
    buildLegacyAccounting([...cases].reverse(), {
      ...ledger,
      obligations: [...ledger.obligations].reverse(),
    }),
  ).toEqual(accounting);
});

test('raw source rows remain verbatim across unit evidence and scope exclusions', () => {
  const ledger = loadLegacyObligations();
  // Captured directly from the pinned 41-row dataset, before authoring obligations.
  expect(legacySourceDigest(ledger.rows)).toBe(
    'ff9a28682bd61985a2ae4e680e6c836bbcead383f61d89643ba4580dd59baf9d',
  );
  for (const obligation of ledger.obligations) {
    const row = ledger.rows.find((row) => row.pointer === obligation.pointer);
    if (!row) throw new Error('Missing source row');
    expect(legacySourceDigest(obligation.row)).toBe(row.sha256);
    expect(Object.hasOwn(obligation, 'profile')).toBe(false);
    expect(Object.hasOwn(obligation, 'fixtureId')).toBe(false);
    expect(Object.hasOwn(obligation, 'oracle')).toBe(false);
    if (obligation.status === 'blocked')
      expect(obligation.blocker.unconfirmed.length).toBeGreaterThan(0);
    else if (obligation.status === 'current-unit-test-evidence')
      expect(obligation.evidence.limitations.length).toBeGreaterThan(0);
    else expect(obligation.reason.trim().length).toBeGreaterThan(0);
  }
  expect(ledger.obligations.filter((row) => row.status === 'blocked')).toEqual(
    [],
  );
  expect(ledger.obligations.some((row) => row.pointer === '/items/34')).toBe(
    false,
  );
  expect(
    buildLegacyAccounting(
      loadOfflineCases(),
      ledger,
    ).rowsWithBoundedCaseEvidence.find((row) => row.pointer === '/items/34')
      ?.caseIds,
  ).toEqual(['three-vessel-addition']);
  expect(ledger.obligations.some((row) => row.pointer === '/items/38')).toBe(
    false,
  );
  expect(
    buildLegacyAccounting(
      loadOfflineCases(),
      ledger,
    ).rowsWithBoundedCaseEvidence.find((row) => row.pointer === '/items/38')
      ?.caseIds,
  ).toEqual(['weather-action-backed-transition']);
  expect(
    ledger.rows
      .filter((row) => row.id === 'cap-maelstrom-edge-deterministic-actions')
      .map((row) => row.pointer),
  ).toEqual(['/items/37', '/items/38', '/items/39', '/items/40']);
});

test('D04 is excluded by user decision without losing pinned provenance or becoming evidence', () => {
  const cases = loadOfflineCases();
  const ledger = loadLegacyObligations();
  const d04 = ledger.obligations.find(({ pointer }) => pointer === '/items/3');
  if (d04?.status !== 'out-of-scope')
    throw new Error('Missing D04 scope exclusion');
  expect(d04.row).toEqual({
    id: 'reg-ai-chat-schema-enforced-lab-extraction',
    input: {
      prompt: 'schemaId=lab-extraction with malformed draft output',
      target: 'shared-ai.chat',
    },
    expectedOutput: {
      rule: 'response matches extraction schema or clean failure',
    },
    metadata: { category: 'regression' },
  });
  expect(ledger.source).toEqual({
    revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
    path: 'langfuse/maelstrom-eval-dataset.v1.json',
  });
  expect(ledger.rows[3]).toEqual({
    pointer: '/items/3',
    id: d04.row.id,
    sha256: '2ab6e5f5ab34937ddb242debfe97cf47208943ce7aa1ec6ba8ebf0dbe62cb112',
  });
  expect(legacySourceDigest(d04.row)).toBe(ledger.rows[3].sha256);
  expect(d04.reason).toContain('user excluded D04 from the unification scope');
  expect(d04.reason).toContain('lab-extraction schema body');
  expect(d04.reason).toContain('clean-failure contract');
  expect(Object.keys(d04).sort()).toEqual([
    'pointer',
    'reason',
    'row',
    'status',
  ]);
  const accounting = buildLegacyAccounting(cases, ledger);
  expect(accounting.outOfScopeObligations).toContainEqual({
    pointer: '/items/3',
    datasetId: d04.row.id,
    reason: d04.reason,
  });
  for (const rows of [
    accounting.rowsWithBoundedCaseEvidence,
    accounting.rowsWithBoundedCodeUnitEvidence,
    accounting.sourceOnlyBlockedObligations,
  ])
    expect(rows.some(({ pointer }) => pointer === '/items/3')).toBe(false);
  expect(
    cases.some(({ definition }) =>
      definition.lineage.some(
        (source) => source.source === 'legacy' && source.pointer === '/items/3',
      ),
    ),
  ).toBe(false);
});

test('D05 is excluded by user decision without losing pinned provenance or becoming evidence', () => {
  const cases = loadOfflineCases();
  const ledger = loadLegacyObligations();
  const d05 = ledger.obligations.find(({ pointer }) => pointer === '/items/4');
  if (d05?.status !== 'out-of-scope')
    throw new Error('Missing D05 scope exclusion');
  expect(d05.row).toEqual({
    id: 'reg-labs-extraction-error-wrap',
    input: {
      prompt: 'Force extraction provider failure',
      target: 'labs.extract',
    },
    expectedOutput: { rule: 'AIExtractionError surfaced' },
    metadata: { category: 'regression' },
  });
  expect(ledger.rows).toHaveLength(41);
  expect(ledger.rows[4]).toEqual({
    pointer: '/items/4',
    id: d05.row.id,
    sha256: '47b1f237cc108381a16ba07bbb24993a6a7dad5d7c01c309ae7b1486de93e5a5',
  });
  expect(legacySourceDigest(d05.row)).toBe(ledger.rows[4].sha256);
  expect(d05.reason).toContain('user excluded D05');
  expect(d05.reason).toContain('like D04');
  expect(d05.reason).toContain(
    'no current Labs extraction API, schema or failure contract was authorized',
  );
  expect(Object.keys(d05).sort()).toEqual([
    'pointer',
    'reason',
    'row',
    'status',
  ]);
  const accounting = buildLegacyAccounting(cases, ledger);
  expect(accounting.outOfScopeObligations).toContainEqual({
    pointer: '/items/4',
    datasetId: d05.row.id,
    reason: d05.reason,
  });
  for (const rows of [
    accounting.rowsWithBoundedCaseEvidence,
    accounting.rowsWithBoundedCodeUnitEvidence,
    accounting.sourceOnlyBlockedObligations,
  ])
    expect(rows.some(({ pointer }) => pointer === '/items/4')).toBe(false);
  expect(
    cases.some(({ definition }) =>
      definition.lineage.some(
        (source) => source.source === 'legacy' && source.pointer === '/items/4',
      ),
    ),
  ).toBe(false);
});

test('D06 is excluded by user decision without losing pinned provenance or becoming evidence', () => {
  const cases = loadOfflineCases();
  const ledger = loadLegacyObligations();
  const d06 = ledger.obligations.find(({ pointer }) => pointer === '/items/5');
  if (d06?.status !== 'out-of-scope')
    throw new Error('Missing D06 scope exclusion');
  expect(d06.row).toEqual({
    id: 'reg-labs-job-non-lab-key',
    input: {
      prompt: 'S3 event contains key outside labs/<user>/<file>',
      target: 'labs.job',
    },
    expectedOutput: { rule: 'invalid key skipped without batch crash' },
    metadata: { category: 'regression' },
  });
  expect(ledger.rows[5]).toEqual({
    pointer: '/items/5',
    id: d06.row.id,
    sha256: 'f0255965d7a0ba8c58f352c09aba8a2223cd876099d374733763e71255736d19',
  });
  expect(legacySourceDigest(d06.row)).toBe(ledger.rows[5].sha256);
  expect(d06.reason).toContain('user excluded D06');
  expect(d06.reason).toContain('no current Labs S3 job');
  expect(d06.reason).toContain('no S3 event envelope, batch result');
  expect(Object.keys(d06).sort()).toEqual([
    'pointer',
    'reason',
    'row',
    'status',
  ]);
  const accounting = buildLegacyAccounting(cases, ledger);
  expect(accounting.outOfScopeObligations).toContainEqual({
    pointer: '/items/5',
    datasetId: d06.row.id,
    reason: d06.reason,
  });
  for (const rows of [
    accounting.rowsWithBoundedCaseEvidence,
    accounting.rowsWithBoundedCodeUnitEvidence,
    accounting.sourceOnlyBlockedObligations,
  ])
    expect(rows.some(({ pointer }) => pointer === '/items/5')).toBe(false);
  expect(
    cases.some(({ definition }) =>
      definition.lineage.some(
        (source) => source.source === 'legacy' && source.pointer === '/items/5',
      ),
    ),
  ).toBe(false);
});

test('scope exclusions require a bounded reason and reject evidence, executable fields and altered source rows', () => {
  for (const pointer of Array.from(
    { length: 8 },
    (_, i) => `/items/${i + 3}`,
  )) {
    for (const patch of [
      { reason: undefined },
      { reason: '' },
      { reason: '   ' },
      { reason: 'x'.repeat(2001) },
      { reason: null },
      { reason: 42 },
      { status: 'excluded' },
      { blocker: {} },
      { evidence: {} },
      { fixtureId: 'fake' },
      { profile: 'fake' },
      { oracle: { id: 'fake', version: 1 } },
      { evaluation: 'pass' },
    ]) {
      const data = document();
      const obligation = data.obligations.find(
        (row: { pointer: string }) => row.pointer === pointer,
      );
      Object.assign(obligation, patch);
      expect(() => legacyObligationsSchema.parse(data)).toThrow();
    }
    const data = document();
    const obligation = data.obligations.find(
      (row: { pointer: string }) => row.pointer === pointer,
    );
    obligation.row.expectedOutput.rule = 'No longer needs validation';
    expect(() => legacyObligationsSchema.parse(data)).toThrow();
  }
});

test('D01 links only the existing provider-input unit assertion, not a runnable case', () => {
  const ledger = loadLegacyObligations();
  const obligation = ledger.obligations.find(
    ({ pointer }) => pointer === '/items/0',
  );
  if (obligation?.status !== 'current-unit-test-evidence')
    throw new Error('Missing D01 bounded code-unit evidence');
  expect(obligation.row).toEqual({
    id: 'reg-maelstrom-history-used-when-available',
    input: {
      prompt: 'Turn 2 depends on prior context',
      target: 'maelstrom.process',
    },
    expectedOutput: { rule: 'history-aware provider path used' },
    metadata: { category: 'regression' },
  });
  expect(obligation.evidence.testPath).toBe(
    'packages/planner-llm/src/lib/llm-planner.test.ts',
  );
  expect(obligation.evidence.testName).toBe(
    'D01 bounded provider-input evidence: sends the system prompt, history, then the user prompt',
  );
  const source = readFileSync(
    new URL(`../../${obligation.evidence.testPath}`, import.meta.url),
    'utf8',
  );
  expect(source.split(`test('${obligation.evidence.testName}',`)).toHaveLength(
    2,
  );
  expect(obligation.evidence.scope).toContain(
    'provider-input history propagation only',
  );
  expect(obligation.evidence.limitations.join(' ')).toContain(
    'No Engine multi-turn session or model semantic reliance',
  );
  expect(obligation.evidence.limitations.join(' ')).toContain(
    'unspecified Turn-2 setup is not reconstructed',
  );
  const accounting = buildLegacyAccounting(loadOfflineCases(), ledger);
  expect(
    accounting.rowsWithBoundedCodeUnitEvidence.map((row) => row.pointer),
  ).toEqual(['/items/0']);
  expect(
    accounting.rowsWithBoundedCaseEvidence.some(
      ({ pointer }) => pointer === '/items/0',
    ),
  ).toBe(false);
});

for (const [index, sourceRow] of (
  [
    {
      id: 'reg-voice-stt-api-key-required',
      input: {
        prompt: 'Create STT provider without API key',
        target: 'voice.stt',
      },
      expectedOutput: {
        rule: 'explicit missing API key error',
      },
      metadata: {
        category: 'regression',
      },
    },
    {
      id: 'reg-voice-stt-send-audio-without-connection',
      input: {
        prompt: 'Send audio before STT connect',
        target: 'voice.stt',
      },
      expectedOutput: {
        rule: 'error event emitted, process alive',
      },
      metadata: {
        category: 'regression',
      },
    },
    {
      id: 'reg-voice-tts-no-voice-id',
      input: {
        prompt: 'Call speak without voice id',
        target: 'voice.tts',
      },
      expectedOutput: {
        rule: 'error event emitted',
      },
      metadata: {
        category: 'regression',
      },
    },
    {
      id: 'reg-voice-engine-state-transitions',
      input: {
        prompt: 'Simulate transcript final and TTS completion',
        target: 'voice.engine',
      },
      expectedOutput: {
        rule: 'valid state sequence',
      },
      metadata: {
        category: 'regression',
      },
    },
    {
      id: 'reg-voice-engine-barge-in-interrupt',
      input: {
        prompt: 'Trigger speech_start during speaking',
        target: 'voice.engine',
      },
      expectedOutput: {
        rule: 'TTS interrupted and listening restored',
      },
      metadata: {
        category: 'regression',
      },
    },
  ] as const
).entries()) {
  const number = index + 7;
  const label = `D${String(number).padStart(2, '0')}`;
  test(`${label} is deferred from active voice/audio coverage without losing provenance`, () => {
    const cases = loadOfflineCases();
    const ledger = loadLegacyObligations();
    const pointer = `/items/${number - 1}`;
    const obligation = ledger.obligations.find(
      (row) => row.pointer === pointer,
    );
    if (obligation?.status !== 'out-of-scope')
      throw new Error(`Missing ${label} scope exclusion`);
    expect(obligation.row).toEqual(sourceRow);
    expect(legacySourceDigest(obligation.row)).toBe(
      ledger.rows[number - 1].sha256,
    );
    expect(obligation.reason).toContain(
      'user deferred all voice/audio-related rows (D07-D11)',
    );
    expect(Object.keys(obligation).sort()).toEqual([
      'pointer',
      'reason',
      'row',
      'status',
    ]);
    const accounting = buildLegacyAccounting(cases, ledger);
    expect(accounting.outOfScopeObligations).toContainEqual({
      pointer,
      datasetId: sourceRow.id,
      reason: obligation.reason,
    });
    for (const rows of [
      accounting.rowsWithBoundedCaseEvidence,
      accounting.rowsWithBoundedCodeUnitEvidence,
      accounting.sourceOnlyBlockedObligations,
    ])
      expect(rows.some((row) => row.pointer === pointer)).toBe(false);
    expect(
      cases.some(({ definition }) =>
        definition.lineage.some(
          (source) => source.source === 'legacy' && source.pointer === pointer,
        ),
      ),
    ).toBe(false);
  });
}

test('ledger rejects duplicate/missing/out-of-range pointers, altered raw rows and invented executable fields', () => {
  for (const mutate of [
    (data: ReturnType<typeof document>) => {
      data.rows.pop();
    },
    (data: ReturnType<typeof document>) => {
      data.rows[1] = data.rows[0];
    },
    (data: ReturnType<typeof document>) => {
      data.rows[0].pointer = '/items/41';
    },
    (data: ReturnType<typeof document>) => {
      data.obligations.push(data.obligations[0]);
    },
    (data: ReturnType<typeof document>) => {
      data.obligations[0].pointer = '/items/35';
    },
    (data: ReturnType<typeof document>) => {
      data.obligations[0].row.id = 'another-task';
    },
    (data: ReturnType<typeof document>) => {
      data.obligations[0].row.input.prompt = 'Invented setup';
    },
    (data: ReturnType<typeof document>) => {
      data.obligations[0].row.expectedOutput.rule = 'Always pass';
    },
    (data: ReturnType<typeof document>) => {
      data.obligations[0].profile = 'fake';
    },
    (data: ReturnType<typeof document>) => {
      data.obligations.find(
        (row: { pointer: string }) => row.pointer === '/items/7',
      ).blocker = { owner: 'Invented' };
    },
    (data: ReturnType<typeof document>) => {
      data.obligations[0].evidence.testPath = '../fake.test.ts';
    },
    (data: ReturnType<typeof document>) => {
      data.obligations[0].evidence.testPath =
        'packages/evals/cases/v1/fake.json';
    },
    (data: ReturnType<typeof document>) => {
      data.obligations[0].evidence.testName = '';
    },
    (data: ReturnType<typeof document>) => {
      data.obligations[0].evidence.limitations = [];
    },
    (data: ReturnType<typeof document>) => {
      data.obligations[0].evidence.scope = '';
    },
    (data: ReturnType<typeof document>) => {
      data.obligations[0].evidence.fixtureId = 'fake';
    },
    (data: ReturnType<typeof document>) => {
      data.obligations[0].status = 'blocked';
    },
    (data: ReturnType<typeof document>) => {
      data.obligations[1].evidence = data.obligations[0].evidence;
    },
    (data: ReturnType<typeof document>) => {
      data.obligations.push({
        ...data.obligations[0],
        status: 'blocked',
        evidence: undefined,
        blocker: { kind: 'unregistered-task', verified: [], unconfirmed: [] },
      });
    },
    (data: ReturnType<typeof document>) => {
      data.source.revision = '0'.repeat(40);
    },
  ]) {
    const data = document();
    mutate(data);
    expect(() => legacyObligationsSchema.parse(data)).toThrow();
  }
});

test('accounting rejects holes, overlapping classifications, duplicate cases and mismatched lineage', () => {
  const cases = loadOfflineCases();
  const ledger = loadLegacyObligations();
  expect(() => buildLegacyAccounting(cases.slice(1), ledger)).toThrow();
  expect(() =>
    buildLegacyAccounting(cases, {
      ...ledger,
      obligations: ledger.obligations.slice(1),
    }),
  ).toThrow();
  expect(() => buildLegacyAccounting([...cases, cases[0]], ledger)).toThrow();
  for (const obligation of ledger.obligations) {
    expect(() =>
      buildLegacyAccounting(cases, {
        ...ledger,
        obligations: ledger.obligations.filter((row) => row !== obligation),
      }),
    ).toThrow();
    const overlapping = {
      definition: {
        id: 'fake-case',
        lineage: [
          {
            source: 'legacy' as const,
            ...ledger.source,
            pointer: obligation.pointer,
            taskId: obligation.row.id,
            datasetId: obligation.row.id,
          },
        ],
      },
    };
    expect(() =>
      buildLegacyAccounting([...cases, overlapping], ledger),
    ).toThrow();
  }
  const base = cases.find(
    (item) => item.definition.id === 'weather-deterministic-cycle',
  );
  if (!base) throw new Error('Missing D40');
  for (const field of ['pointer', 'taskId', 'datasetId', 'path', 'revision']) {
    const changed = structuredClone(base);
    (changed.definition.lineage[0] as unknown as Record<string, unknown>)[
      field
    ] = 'invalid';
    expect(() =>
      buildLegacyAccounting(
        cases.map((item) => (item === base ? changed : item)),
        ledger,
      ),
    ).toThrow();
  }
  const duplicated = structuredClone(base);
  duplicated.definition.lineage.push(duplicated.definition.lineage[0]);
  expect(() =>
    buildLegacyAccounting(
      cases.map((item) => (item === base ? duplicated : item)),
      ledger,
    ),
  ).toThrow();
});

test('CLI composes legacy obligations with the read-only inventory without evaluating them', () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      '--no-env-file',
      '--conditions=@maelstrom-co/source',
      new URL('./inventory-cli.ts', import.meta.url).pathname,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  expect(result.exitCode).toBe(0);
  const report = JSON.parse(result.stdout.toString());
  expect(report.legacy.counts).toMatchObject({
    accountedRows: 41,
    rowsWithBoundedCaseEvidence: 32,
    rowsWithBoundedCodeUnitEvidence: 1,
    sourceOnlyBlockedObligations: 0,
    outOfScopeObligations: 8,
    unaccountedRows: 0,
  });
  const ledger = loadLegacyObligations();
  expect(report.legacy.outOfScopeObligations).toEqual(
    ledger.obligations
      .filter((row) => row.status === 'out-of-scope')
      .map((row) => ({
        pointer: row.pointer,
        datasetId: row.row.id,
        reason: row.reason,
      })),
  );
  expect(
    report.legacy.outOfScopeObligations.map(
      ({ pointer }: { pointer: string }) => pointer,
    ),
  ).toEqual(Array.from({ length: 8 }, (_, i) => `/items/${i + 3}`));
  expect(report.legacy.sourceOnlyBlockedObligations).toEqual([]);
  expect(
    report.legacy.rowsWithBoundedCodeUnitEvidence.map(
      ({ pointer }: { pointer: string }) => pointer,
    ),
  ).toEqual(['/items/0']);
  expect(report.counts).toMatchObject({
    cases: 43,
    fixtures: 35,
    uniqueProfiles: 30,
  });
  expect(report.unknownCaseScenarioReferences).toEqual([]);
  expect(Object.hasOwn(report.legacy, 'evaluation')).toBe(false);
});
