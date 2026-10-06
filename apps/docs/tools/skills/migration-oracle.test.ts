import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateMigration, prepareMigration } from './migration-cli';
import { positiveApp } from './migration-fixture';
import { cloneMigrationTree } from './migration-process';

let base: string;
let seal: string;

beforeAll(async () => {
  base = join(
    await mkdtemp(join(tmpdir(), 'migration-uncertainty-')),
    'prepared',
  );
  const prepared = await prepareMigration(base);
  base = prepared.base;
  seal = prepared.seal;
  expect(prepared.selfCheckVerified).toBe(true);
  await writeFile(
    join(base, 'baseline/src/orders.test.ts'),
    'throw new Error("unused arm must fail integrity before execution");',
  );
}, 240_000);

afterAll(async () => {
  if (base) await rm(base, { recursive: true, force: true });
}, 60_000);

async function evaluateMutation(source: string) {
  const consumer = await mkdtemp(join(tmpdir(), 'migration-oracle-case-'));
  await mkdir(join(consumer, 'protected'));
  try {
    for (const arm of ['baseline', 'treatment'])
      await cloneMigrationTree(join(base, arm), join(consumer, arm));
    for (const file of ['prepared.json', 'oracle.test.tsx', 'reference.tsx'])
      await writeFile(
        join(consumer, 'protected', file),
        await readFile(join(base, 'protected', file)),
      );
    await writeFile(join(consumer, 'treatment/src/OrdersApp.tsx'), source);
    return await evaluateMigration(consumer, seal, true, [], false, 15_000);
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}

test('uncertain cancellation cannot display a cancelled order while permitting another cancel', async () => {
  const optimistic = positiveApp
    .replace(
      '} catch { setError(',
      "} catch { setOrders(rows => rows.map(row => row.id === pending ? { ...row, status: 'cancelled' } : row)); setError(",
    )
    .replace(
      "row.status !== 'pending'",
      "(row.status !== 'pending' && !error)",
    );
  const result = await evaluateMutation(optimistic);
  for (const flag of [false, true]) {
    expect(
      result.results[1].functionalOutcomes?.[
        `does not retry or claim success after an uncertain cancellation: ${flag}`
      ],
    ).toBe(false);
  }
}, 120_000);

test('uncertain cancellation cannot mutate service records even when the rendered status stays pending', async () => {
  const mutated = positiveApp.replace(
    '} catch { setError(',
    "} catch { const failed = orders.find(row => row.id === pending); if (failed) failed.status = 'cancelled'; setOrders(rows => rows.map(row => row.id === pending ? { ...row, status: 'pending' } : row)); setError(",
  );
  const result = await evaluateMutation(mutated);
  for (const flag of [false, true]) {
    expect(
      result.results[1].functionalOutcomes?.[
        `does not retry or claim success after an uncertain cancellation: ${flag}`
      ],
    ).toBe(false);
  }
}, 120_000);
