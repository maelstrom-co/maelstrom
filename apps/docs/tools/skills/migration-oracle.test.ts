import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateMigration, prepareMigration } from './migration-cli';
import { negativeApp, positiveApp } from './migration-fixture';

let base: string;
let seal: string;

beforeAll(async () => {
  base = join(
    await mkdtemp(join(tmpdir(), 'migration-uncertainty-')),
    'prepared',
  );
  const prepared = await prepareMigration(base);
  seal = prepared.seal;
  expect(prepared.selfCheckVerified).toBe(true);
}, 240_000);

afterAll(async () => {
  if (base) await rm(base, { recursive: true, force: true });
}, 60_000);

test('uncertain cancellation cannot display a cancelled order while permitting another cancel', async () => {
  const app = join(base, 'treatment/src/OrdersApp.tsx');
  const optimistic = positiveApp
    .replace(
      '} catch { setError(',
      "} catch { setOrders(rows => rows.map(row => row.id === pending ? { ...row, status: 'cancelled' } : row)); setError(",
    )
    .replace(
      "row.status !== 'pending'",
      "(row.status !== 'pending' && !error)",
    );
  await writeFile(app, optimistic);
  try {
    const result = await evaluateMigration(base, seal, true);
    for (const flag of [false, true]) {
      expect(
        result.results[1].functionalOutcomes?.[
          `does not retry or claim success after an uncertain cancellation: ${flag}`
        ],
      ).toBe(false);
    }
  } finally {
    await writeFile(app, negativeApp);
  }
}, 120_000);

test('uncertain cancellation cannot mutate service records even when the rendered status stays pending', async () => {
  const app = join(base, 'treatment/src/OrdersApp.tsx');
  const mutated = positiveApp.replace(
    '} catch { setError(',
    "} catch { const failed = orders.find(row => row.id === pending); if (failed) failed.status = 'cancelled'; setOrders(rows => rows.map(row => row.id === pending ? { ...row, status: 'pending' } : row)); setError(",
  );
  await writeFile(app, mutated);
  try {
    const result = await evaluateMigration(base, seal, true);
    for (const flag of [false, true]) {
      expect(
        result.results[1].functionalOutcomes?.[
          `does not retry or claim success after an uncertain cancellation: ${flag}`
        ],
      ).toBe(false);
    }
  } finally {
    await writeFile(app, negativeApp);
  }
}, 120_000);
