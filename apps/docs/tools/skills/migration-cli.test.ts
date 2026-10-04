import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateMigration, prepareMigration } from './migration-cli';
import { migrationSnapshot } from './migration-evaluation';
import { negativeApp, positiveApp } from './migration-fixture';

let base: string;
let seal: string;
beforeAll(async () => {
  base = join(await mkdtemp(join(tmpdir(), 'migration-cli-')), 'prepared');
  const prepared = await prepareMigration(base);
  seal = prepared.seal;
  expect(prepared.selfCheckVerified).toBe(true);
}, 240_000);
afterAll(async () => {
  if (base) await rm(base, { recursive: true, force: true });
}, 60_000);

const integrationRegression = `import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { EngineConnector } from '@maelstrom-co/client';
import { OrdersApp } from './OrdersApp';
import { seed } from './orders';
afterEach(cleanup);
it('the migration must connect the supplied transport instead of silently using legacy results', async () => {
  const connector = { capabilities: { voice: false, streaming: false, stateful: false }, connect: vi.fn(async () => {}), disconnect: async () => {}, subscribe: () => () => {}, process: async () => { throw new Error('No engine request expected'); }, addAssistantMessage: async () => {}, getHistory: async () => [] } satisfies EngineConnector;
  render(<OrdersApp useMaelstromOrders connector={connector} service={{ list: async () => seed, cancel: async () => {} }} session={{ canCancel: true }} />);
  await screen.findByRole('heading', { name: 'A-100' });
  expect(connector.connect).toHaveBeenCalledTimes(1);
});
`;

async function isolateTreatment() {
  const path = join(base, 'baseline/src/orders.test.ts');
  const original = await readFile(path);
  await writeFile(
    path,
    'throw new Error("unused arm must fail integrity before execution");',
  );
  return () => writeFile(path, original);
}

test('added tests must detect the original missing capability; tautologies do not count', async () => {
  const app = join(base, 'treatment/src/OrdersApp.tsx');
  const regression = join(base, 'treatment/src/migration.test.tsx');
  await writeFile(app, positiveApp);
  const restoreBaseline = await isolateTreatment();
  try {
    await writeFile(regression, integrationRegression);
    const before = await migrationSnapshot(join(base, 'treatment'));
    const meaningful = await evaluateMigration(base, seal, true);
    expect(meaningful.results[1].regression.status).toBe(
      'provisional-detection',
    );
    expect(meaningful.results[1].regression.assertionRegressions).toEqual([
      'src/migration.test.tsx',
    ]);
    expect(meaningful.results[1].automatedPassed).toBe(true);
    expect(meaningful.results[1].passed).toBe(false);
    expect(meaningful.review.status).toBe('pending');
    expect(await migrationSnapshot(join(base, 'treatment'))).toEqual(before);
    await writeFile(
      regression,
      "import { expect, it } from 'vitest'; it('tautology', () => { expect(true).toBe(true); });",
    );
    const tautology = await evaluateMigration(base, seal, true);
    expect(tautology.results[1].regression.status).toBe(
      'no-capability-regression',
    );
    expect(tautology.results[1].passed).toBe(false);
  } finally {
    await writeFile(app, negativeApp);
    await unlink(regression);
    await restoreBaseline();
  }
}, 180_000);

test('source-text assertions remain unreviewed even when the automatic counterfactual detects them', async () => {
  const app = join(base, 'treatment/src/OrdersApp.tsx');
  const regression = join(base, 'treatment/src/source-text.test.ts');
  await writeFile(app, positiveApp);
  const restoreBaseline = await isolateTreatment();
  try {
    await writeFile(
      regression,
      "import { expect, it } from 'vitest'; import { OrdersApp } from './OrdersApp'; it('a source spelling is not rendered behavior', () => { expect(OrdersApp.toString()).toContain('sdk.Provider'); });",
    );
    const evidence = await evaluateMigration(base, seal, true);
    expect(evidence.results[1].regression.status).toBe('provisional-detection');
    expect(evidence.results[1].automatedPassed).toBe(true);
    expect(evidence.results[1].passed).toBe(false);
    expect(evidence.review.status).toBe('pending');
    expect(evidence.comparison.savings).toBeNull();
  } finally {
    await writeFile(app, negativeApp);
    await unlink(regression);
    await restoreBaseline();
  }
}, 90_000);

for (let attempt = 0; attempt < 2; attempt++) {
  test(`counterfactual hangs are bounded and cleaned without claiming a regression: attempt ${attempt + 1}`, async () => {
    const app = join(base, 'treatment/src/OrdersApp.tsx');
    const regression = join(base, 'treatment/src/migration.test.tsx');
    await writeFile(app, positiveApp);
    const restoreBaseline = await isolateTreatment();
    try {
      await writeFile(
        regression,
        integrationRegression.replace(
          '  expect(connector.connect)',
          '  if (connector.connect.mock.calls.length === 0) for (;;) { Math.sqrt(4); }\n  expect(connector.connect)',
        ),
      );
      const before = await migrationSnapshot(join(base, 'treatment'));
      const hanging = await evaluateMigration(
        base,
        seal,
        true,
        [],
        false,
        30_000,
        2_000,
      );
      expect(hanging.results[1].tests).toBe(true);
      expect(hanging.results[1].regression.status).toBe('timeout');
      expect([undefined, 'termination-permission-denied']).toContain(
        hanging.results[1].regression.detail,
      );
      expect(hanging.results[1].regression.assertionRegressions).toEqual([]);
      expect(hanging.results[1].passed).toBe(false);
      expect(
        (await readdir(join(base, 'protected'))).filter((path) =>
          path.includes('counterfactual'),
        ),
      ).toEqual([]);
      expect(await migrationSnapshot(join(base, 'treatment'))).toEqual(before);
    } finally {
      await writeFile(app, negativeApp);
      await unlink(regression);
      await restoreBaseline();
    }
  }, 120_000);
}

test('the prepared contract rejects evaluation without explicit untrusted-code consent', async () => {
  await expect(evaluateMigration(base, seal, false)).rejects.toThrow(
    'untrusted code',
  );
});

test('an independent reference succeeds but a connector substitute fails the external oracle', async () => {
  const reference = await evaluateMigration(base, seal, true, [], true);
  expect(reference.selfCheckVerified).toBe(true);
  expect(reference.results[0].functional).toBe(false);
  expect(reference.results[1].functional).toBe(true);
  expect(reference.results[1].usage).toBeNull();
  expect(reference.comparison.savings).toBeNull();
  const app = join(base, 'treatment/src/OrdersApp.tsx');
  await writeFile(
    app,
    positiveApp.replace(
      'connector={connector}',
      'connector={{ ...connector }}',
    ),
  );
  try {
    const evaluation = await evaluateMigration(base, seal, true);
    expect(evaluation.results[1].typecheck).toBe(true);
    expect(
      evaluation.results[1].functionalOutcomes?.[
        'uses the supplied installed SDK connector and preserves filtering: true'
      ],
    ).toBe(false);
  } finally {
    await writeFile(app, negativeApp);
  }
}, 120_000);

test('SDK or original test tampering is rejected before any consumer code runs', async () => {
  const path = join(base, 'baseline/src/orders.test.ts');
  const original = await readFile(path);
  const sdk = join(
    base,
    'baseline/node_modules/@maelstrom-co/react/dist/index.js',
  );
  const originalSdk = await readFile(sdk);
  await writeFile(path, 'throw new Error("must never run");');
  await writeFile(sdk, 'throw new Error("substitute SDK must never run");');
  try {
    const evaluation = await evaluateMigration(base, seal, true);
    expect(evaluation.results[0].preserved).toBe(false);
    expect(evaluation.results[0].immutable).toContain('src/orders.test.ts');
    expect(evaluation.results[0].immutable).toContain(
      'node_modules/@maelstrom-co/react/dist/index.js',
    );
    expect(evaluation.results[0].typecheck).toBe(false);
  } finally {
    await writeFile(path, original);
    await writeFile(sdk, originalSdk);
  }
}, 60_000);

test('a stale seal, oracle replacement, and symlink escape cannot receive results', async () => {
  await expect(evaluateMigration(base, '0'.repeat(64), true)).rejects.toThrow(
    'seal mismatch',
  );
  const oracle = join(base, 'protected/oracle.test.tsx');
  const original = await readFile(oracle);
  await writeFile(oracle, 'tampered');
  try {
    await expect(evaluateMigration(base, seal, true)).rejects.toThrow(
      'tampering',
    );
  } finally {
    await writeFile(oracle, original);
  }
  const link = join(base, 'baseline/src/escape.ts');
  await symlink(oracle, link);
  try {
    await expect(evaluateMigration(base, seal, true)).rejects.toThrow(
      'Symlinks',
    );
  } finally {
    await unlink(link);
  }
}, 60_000);

test('bounded checks do not call a timeout a successful run', async () => {
  const result = await evaluateMigration(base, seal, true, [], false, 1);
  expect(result.results[0].passed).toBe(false);
  expect(result.results[0].executionChecks?.functional).toBe('timeout');
  expect(result.comparison.eligible).toBe(false);
}, 60_000);
