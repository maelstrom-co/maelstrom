import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateMigration, prepareMigration } from './migration-cli';
import { migrationSnapshot, piEvidence } from './migration-evaluation';
import { negativeApp, positiveApp } from './migration-fixture';
import { oracleCriteria } from './migration-oracle';
import { migrationProcessEvidenceDirectory } from './migration-process';

let base: string;
let seal: string;
beforeAll(async () => {
  base = join(await mkdtemp(join(tmpdir(), 'migration-cli-')), 'prepared');
  const prepared = await prepareMigration(base);
  base = prepared.base;
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

test('dependency download caches are not copied into sealed source consumers', async () => {
  const prepared = JSON.parse(
    await readFile(join(base, 'protected/prepared.json'), 'utf8'),
  );
  for (const arm of ['baseline', 'treatment']) {
    expect(
      Object.keys(prepared.snapshots[arm]).filter((path) =>
        path.startsWith('.bun/'),
      ),
    ).toEqual([]);
  }
});

test('prepared guide receipts require the complete instructions rather than one introductory line', async () => {
  const prepared = JSON.parse(
    await readFile(join(base, 'protected/prepared.json'), 'utf8'),
  );
  const path = join(
    base,
    'treatment/.agents/skills/maelstrom-react-migration/SKILL.md',
  );
  const text = await readFile(path, 'utf8');
  const heading = text.match(/^# .+$/m)?.[0];
  const introduction = text
    .slice(text.indexOf(heading!) + heading!.length)
    .split('\n')
    .find((line) => line.length > 30 && !line.startsWith('#'));
  const evidence = piEvidence(
    [
      {
        type: 'tool_execution_start',
        toolName: 'read',
        toolCallId: 'partial',
        args: { path },
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'partial',
        isError: false,
        result: {
          content: [{ type: 'text', text: `${heading}\n${introduction}` }],
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n'),
    {
      cwd: join(base, 'treatment'),
      prompt: '',
      guides: prepared.guideEvidence.treatment,
    },
  );
  expect(evidence.activated).toBe(false);
  expect(prepared.guideEvidence.treatment[path].content).toBe(text.trim());
});

test('the sealed local receipt hashes exactly the submitted source and changes after an edit', async () => {
  const cwd = join(base, 'treatment');
  const receipt = async () => {
    const child = Bun.spawn([Bun.which('node')!, 'migration-submission.mjs'], {
      cwd,
      env: { PATH: '/usr/bin:/bin' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const text = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    return JSON.parse(text);
  };
  const before = await receipt();
  const restoreBaseline = await isolateTreatment();
  const app = join(cwd, 'src/OrdersApp.tsx');
  try {
    const result = await evaluateMigration(base, seal, true);
    expect(before.sourceHash).toBe(result.results[1].hashes.submittedSource);
    await writeFile(app, positiveApp);
    const after = await receipt();
    expect(after.sourceHash).not.toBe(before.sourceHash);
    expect(after.attemptId).toBe(before.attemptId);
  } finally {
    await writeFile(app, negativeApp);
    await restoreBaseline();
  }
}, 90_000);

async function isolateTreatment() {
  const path = join(base, 'baseline/src/orders.test.ts');
  const original = await readFile(path);
  await writeFile(
    path,
    'throw new Error("unused arm must fail integrity before execution");',
  );
  return () => writeFile(path, original);
}

test('source organization does not invalidate an otherwise preserved submission', async () => {
  const directory = join(base, 'treatment/src/components');
  await mkdir(directory);
  await writeFile(
    join(directory, 'helper.ts'),
    'export const harmless = true;\n',
  );
  const restoreBaseline = await isolateTreatment();
  try {
    const result = await evaluateMigration(base, seal, true);
    expect(result.results[1].unexpected).toEqual([]);
    expect(result.results[1].preserved).toBe(true);
    expect(result.results[1].typecheck).toBe(true);
  } finally {
    await rm(directory, { recursive: true });
    await restoreBaseline();
  }
}, 90_000);

test('submitted tests cannot replace the independent oracle to pass the missing integration', async () => {
  const testPath = join(base, 'treatment/src/substitution.test.ts');
  const fakeOracle = `import { expect, it } from 'vitest';\n${oracleCriteria
    .map(
      (name) => `it(${JSON.stringify(name)}, () => expect(true).toBe(true));`,
    )
    .join('\n')}`;
  await writeFile(
    testPath,
    `import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('consumer test side effects stay outside the oracle', () => {
  writeFileSync('oracle.test.tsx', ${JSON.stringify(fakeOracle)});
  expect(true).toBe(true);
});\n`,
  );
  const restoreBaseline = await isolateTreatment();
  try {
    const before = await migrationSnapshot(join(base, 'treatment'));
    const result = await evaluateMigration(base, seal, true);
    expect(result.results[1].tests).toBe(true);
    expect(result.results[1].functional).toBe(false);
    expect(await migrationSnapshot(join(base, 'treatment'))).toEqual(before);
  } finally {
    await unlink(testPath);
    await restoreBaseline();
  }
}, 90_000);

test('consumer tests cannot substitute source in a sibling oracle copy', async () => {
  const path = join(base, 'treatment/src/sibling-substitution.test.ts');
  await writeFile(
    path,
    `import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
it('consumer side effects must not change the independent input', () => {
  if (process.cwd().includes('counterfactual')) { expect(true).toBe(false); return; }
  for (const entry of readdirSync('..'))
    if (entry.startsWith('treatment-oracle-'))
      writeFileSync(join('..', entry, 'src/OrdersApp.tsx'), ${JSON.stringify(positiveApp)});
  expect(true).toBe(true);
});\n`,
  );
  const restoreBaseline = await isolateTreatment();
  try {
    const result = await evaluateMigration(base, seal, true);
    expect(result.results[1].tests).toBe(true);
    expect(result.results[1].preserved).toBe(true);
    expect(result.results[1].functional).toBe(false);
    expect(result.results[1].automatedPassed).toBe(false);
  } finally {
    await unlink(path);
    await restoreBaseline();
  }
}, 120_000);

test('an oracle-side deletion fails the check and removes every execution copy', async () => {
  const app = join(base, 'treatment/src/OrdersApp.tsx');
  await writeFile(
    app,
    `import { unlinkSync } from 'node:fs';
if (process.cwd().includes('treatment-oracle-')) unlinkSync('oracle.test.tsx');
${positiveApp}`,
  );
  const restoreBaseline = await isolateTreatment();
  try {
    const result = await evaluateMigration(base, seal, true);
    expect(result.results[1].functional).toBe(false);
    expect(result.results[1].automatedPassed).toBe(false);
    expect(
      (await readdir(join(base, 'protected'))).filter(
        (path) =>
          path.startsWith('treatment-execution-') ||
          path.startsWith('treatment-oracle-'),
      ),
    ).toEqual([]);
  } finally {
    await writeFile(app, negativeApp);
    await restoreBaseline();
  }
}, 90_000);

for (const fault of [
  'cleanup',
  'publication',
  'signal',
  'consumer-cleanup',
] as const) {
  test(`a ${fault} failure cannot qualify as a detected capability regression`, async () => {
    const app = join(base, 'treatment/src/OrdersApp.tsx');
    const regression = join(base, 'treatment/src/migration.test.tsx');
    await writeFile(app, positiveApp);
    await writeFile(regression, integrationRegression);
    const restoreBaseline = await isolateTreatment();
    const ledger = join(
      await migrationProcessEvidenceDirectory(),
      'processes.jsonl',
    );
    const backup = `${ledger}.test-backup`;
    let ledgerReplaced = false;
    let group: number | undefined;
    const originalSpawn = Bun.spawn;
    const spawn = spyOn(Bun, 'spawn').mockImplementation((...args) => {
      const first = args[0];
      const command = Array.isArray(first) ? first : first.cmd;
      const counterfactual =
        command[1]?.endsWith('/migration-process-worker.mjs') &&
        JSON.parse(command[3]).cwd.includes('treatment-counterfactual-');
      const consumer =
        command[1]?.endsWith('/migration-process-worker.mjs') &&
        JSON.parse(command[3]).cwd.includes('treatment-execution-') &&
        JSON.parse(command[3]).args.includes('--exclude');
      let child: ReturnType<typeof Bun.spawn>;
      if (fault === 'signal' && counterfactual) {
        const settings = JSON.parse(command[3]);
        settings.args = [
          settings.args[0],
          '--input-type=commonjs',
          '-e',
          'require("node:child_process").spawnSync(process.execPath,process.argv.slice(1),{stdio:"ignore"});process.kill(process.pid,"SIGKILL");',
          ...settings.args.slice(1),
        ];
        child = originalSpawn(
          [...command.slice(0, 3), JSON.stringify(settings)],
          args[1],
        );
      } else child = originalSpawn(...args);
      if (fault === 'consumer-cleanup' ? consumer : counterfactual)
        group = child.pid;
      if (
        fault !== 'signal' &&
        command[1]?.endsWith('/migration-process-cleanup.mjs') &&
        Number(command[2]) === group
      ) {
        const exited = child.exited.then(async (code) => {
          if (fault === 'cleanup' || fault === 'consumer-cleanup') return 2;
          await rename(ledger, backup);
          await mkdir(ledger);
          ledgerReplaced = true;
          return code;
        });
        return new Proxy(child, {
          get: (target, key) =>
            key === 'exited' ? exited : Reflect.get(target, key),
        });
      }
      return child;
    });
    try {
      if (fault === 'consumer-cleanup') {
        await expect(evaluateMigration(base, seal, true)).rejects.toThrow(
          'cleanup uncertain',
        );
        expect(
          (await readdir(join(base, 'protected'))).filter(
            (path) =>
              path.startsWith('treatment-execution-') ||
              path.startsWith('treatment-oracle-'),
          ),
        ).toEqual([]);
        return;
      }
      const result = await evaluateMigration(base, seal, true);
      expect(group).toBeDefined();
      expect(result.results[1].functional).toBe(true);
      expect(result.results[1].regression.status).toBe('tool-failure');
      expect(result.results[1].automatedPassed).toBe(false);
    } finally {
      spawn.mockRestore();
      if (ledgerReplaced) {
        await rm(ledger, { recursive: true });
        await rename(backup, ledger);
      }
      await writeFile(app, negativeApp);
      await unlink(regression);
      await restoreBaseline();
    }
  }, 120_000);
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
