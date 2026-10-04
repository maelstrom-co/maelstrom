import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSkillsBundle } from './bundle';
import {
  compareMigration,
  migrationSnapshot,
  type PiBinding,
  piEvidence,
} from './migration-evaluation';
import {
  negativeApp,
  ordersSource,
  originalTest,
  positiveApp,
  prompt,
  setupSource,
} from './migration-fixture';
import { oracleCriteria, oracleSource } from './migration-oracle';
import {
  cloneMigrationTree,
  migrationProcessEvidenceDirectory,
  runMigrationProcess,
} from './migration-process';
import { migrationReview } from './migration-review';

const workspace = resolve(import.meta.dir, '../../../..');
const digest = (text: string) =>
  createHash('sha256').update(text).digest('hex');
const config = `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { setupFiles: ['./setup.ts'], include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'oracle.test.tsx'], pool: 'forks', maxWorkers: 1, testTimeout: 5000 } });\n`;
const tsconfig = {
  compilerOptions: {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    jsx: 'react-jsx',
    types: ['node', 'react'],
  },
  include: ['src'],
};
const env = (cwd: string): NodeJS.ProcessEnv => ({
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: cwd,
  TMPDIR: cwd,
  CI: '1',
  NO_COLOR: '1',
});
const contractHash = digest(
  [
    'isolated-processes-and-external-behavioral-review-v3',
    oracleSource,
    positiveApp,
    negativeApp,
    ordersSource,
    originalTest,
    prompt,
    setupSource,
    config,
    JSON.stringify(tsconfig),
  ].join('\n'),
);
const safeBin = async (name: string) =>
  realpath(join(workspace, 'node_modules/.bin', name));

async function command(cwd: string, args: string[], timeout = 120_000) {
  await runMigrationProcess(cwd, args, env(cwd), timeout);
}

function processTimedOut(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.startsWith('Trial timed out;')
  );
}

async function json(path: string) {
  return JSON.parse(await boundedText(path));
}

async function boundedText(path: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 8_000_000)
    throw new Error('Invalid bounded JSON evidence');
  return readFile(path, 'utf8');
}

async function materialize(source: string, target: string) {
  await cloneMigrationTree(source, target);
}

export async function prepareMigration(output: string) {
  const requested = resolve(output);
  await mkdir(requested, { recursive: false, mode: 0o700 });
  const base = await realpath(requested);
  const evidence = join(base, 'protected');
  await mkdir(evidence, { mode: 0o700 });
  const rootManifest = await json(join(workspace, 'package.json'));
  const catalog = rootManifest.catalog;
  const template = join(evidence, 'initial');
  await mkdir(join(template, 'src'), { recursive: true });
  const packageNames = ['protocol', 'client', 'react', 'connectors'];
  const dependencies: Record<string, string> = {};
  const sdkVersions: Record<string, string> = {};
  for (const name of packageNames) {
    const source = join(workspace, 'packages', name);
    const manifest = await json(join(source, 'package.json'));
    sdkVersions[manifest.name] = manifest.version;
    const destination = join(template, 'vendor', name);
    await mkdir(destination, { recursive: true });
    await materialize(join(source, 'dist'), join(destination, 'dist'));
    await materialize(
      join(source, 'README.md'),
      join(destination, 'README.md'),
    );
    await materialize(join(source, 'skills'), join(destination, 'skills'));
    delete manifest.devDependencies;
    delete manifest.nx;
    for (const [dep, version] of Object.entries(manifest.dependencies ?? {})) {
      if (dep.startsWith('@maelstrom-co/')) {
        const local = dep.slice('@maelstrom-co/'.length);
        if (!packageNames.includes(local))
          throw new Error(
            'Unexpected SDK dependency; extend the fixed package set',
          );
        manifest.dependencies[dep] = `file:../${local}`;
      } else if (version === 'catalog:')
        manifest.dependencies[dep] = catalog[dep];
    }
    await writeFile(
      join(destination, 'package.json'),
      JSON.stringify(manifest, null, 2),
    );
    dependencies[manifest.name] = `file:vendor/${name}`;
  }
  for (const name of [
    'react',
    'react-dom',
    '@types/react',
    '@types/react-dom',
    '@types/node',
    'typescript',
    'vitest',
    '@testing-library/react',
    'jsdom',
    '@biomejs/biome',
  ]) {
    const manifest = await json(
      fileURLToPath(import.meta.resolve(`${name}/package.json`)),
    );
    dependencies[name] = manifest.version;
  }
  await writeFile(
    join(template, 'package.json'),
    JSON.stringify(
      {
        name: 'orders-migration-consumer',
        private: true,
        type: 'module',
        scripts: {
          typecheck: 'tsc --noEmit',
          lint: 'biome check src',
          test: 'vitest run',
        },
        dependencies,
      },
      null,
      2,
    ),
  );
  await writeFile(join(template, 'tsconfig.json'), JSON.stringify(tsconfig));
  await writeFile(
    join(template, 'biome.json'),
    JSON.stringify({
      $schema: 'https://biomejs.dev/schemas/2.4.10/schema.json',
      formatter: { enabled: false },
      linter: { enabled: true, rules: { recommended: true } },
      assist: { enabled: false },
    }),
  );
  await writeFile(join(template, 'vitest.config.ts'), config);
  await writeFile(join(template, 'setup.ts'), setupSource);
  await writeFile(join(template, 'src/orders.ts'), ordersSource);
  await writeFile(join(template, 'src/OrdersApp.tsx'), negativeApp);
  await writeFile(join(template, 'src/orders.test.ts'), originalTest);
  await command(
    template,
    [process.execPath, 'install', '--ignore-scripts'],
    240_000,
  );
  const installed = join(evidence, 'installed');
  await materialize(join(template, 'node_modules'), installed);
  const arms = ['baseline', 'treatment'] as const;
  for (const arm of arms) {
    const consumer = join(base, arm);
    await materialize(template, consumer);
    // Bun's local-file packages may contain links. Replace them with frozen regular files.
    await rm(join(consumer, 'node_modules'), { recursive: true });
    await materialize(installed, join(consumer, 'node_modules'));
    if (arm === 'baseline') {
      for (const name of packageNames)
        for (const prefix of ['vendor', 'node_modules/@maelstrom-co'])
          await rm(join(consumer, prefix, name, 'skills'), {
            recursive: true,
            force: true,
          });
    } else {
      const bundle = unzipSync(
        await createSkillsBundle(
          join(workspace, 'apps/docs/skills'),
          join(workspace, 'docs'),
        ),
      );
      for (const [path, contents] of Object.entries(bundle)) {
        const dest = join(
          consumer,
          '.agents/skills',
          path.replace(/^apps\/docs\/skills\//, ''),
        );
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, contents);
      }
    }
    await writeFile(join(consumer, 'PROMPT.md'), prompt);
  }
  await writeFile(join(evidence, 'oracle.test.tsx'), oracleSource);
  await writeFile(join(evidence, 'reference.tsx'), positiveApp);
  const snapshots = Object.fromEntries(
    await Promise.all(
      arms.map(async (arm) => [arm, await migrationSnapshot(join(base, arm))]),
    ),
  );
  const comparable = (snapshot: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(snapshot).filter(
        ([path]) => !path.startsWith('.agents/') && !path.includes('/skills/'),
      ),
    );
  if (
    JSON.stringify(comparable(snapshots.baseline)) !==
    JSON.stringify(comparable(snapshots.treatment))
  )
    throw new Error('Consumer runtime/documents are not matched');
  const guideEvidence: Record<string, PiBinding['guides']> = {};
  for (const arm of arms) {
    guideEvidence[arm] = {};
    for (const path of Object.keys(snapshots[arm]).filter(
      (path) =>
        path === '.agents/skills/maelstrom-react-migration/SKILL.md' ||
        /\/skills\/maelstrom-[\w-]+-sdk\/SKILL\.md$/.test(path),
    )) {
      const text = await boundedText(join(base, arm, path));
      const heading = text.match(/^# [^\n]+/m)?.[0];
      const content = heading
        ? text
            .slice(text.indexOf(heading) + heading.length)
            .split('\n')
            .find((line) => line.length > 30 && !line.startsWith('#'))
        : undefined;
      if (!heading || !content)
        throw new Error('Guide receipt contract is missing expected prose');
      guideEvidence[arm][join(base, arm, path)] = {
        heading,
        content,
        kind: path.startsWith('.agents/') ? 'migration' : 'sdk',
      };
    }
  }
  const provenance = {
    kind: 'local-built-public-sdk',
    sdkVersions,
    lockfileHash: digest(await boundedText(join(workspace, 'bun.lock'))),
    runtimeIdentity:
      'matchedRuntimeHash freezes the initial public runtime, declarations, ordinary documents, configuration, tests, and consumer source; SDK guide files are excluded',
  };
  const prepared = {
    version: 3,
    contractHash,
    guideEvidence,
    provenance,
    oracle: digest(oracleSource),
    reference: digest(positiveApp),
    snapshots,
    matchedRuntimeHash: digest(JSON.stringify(comparable(snapshots.baseline))),
  };
  const text = JSON.stringify(prepared);
  await writeFile(join(evidence, 'prepared.json'), text, { mode: 0o600 });
  const seal = digest(text);
  const preflight = await evaluateMigration(base, seal, true, [], true);
  if (!preflight.selfCheckVerified)
    throw new Error('Trusted fixture/reference preflight failed');
  await writeFile(
    join(evidence, 'preflight.json'),
    JSON.stringify(preflight, null, 2),
  );
  return {
    version: 3,
    provenance,
    base,
    seal,
    consumers: arms.map((arm) => join(base, arm)),
    prompt: 'PROMPT.md',
    selfCheckVerified: true,
    execution:
      'external agents only; exclude protected from agent access; stop agents before evaluation',
    evaluation: 'requires explicit --unsafe-execute; not a sandbox',
  };
}

async function verifyPrepared(base: string, seal: string) {
  const path = join(base, 'protected/prepared.json');
  if (
    !(await lstat(base)).isDirectory() ||
    !(await lstat(join(base, 'protected'))).isDirectory()
  )
    throw new Error('Evidence root must be a regular directory');
  const text = await boundedText(path);
  if (digest(text) !== seal) throw new Error('Prepared seal mismatch');
  const prepared = await json(path);
  if (
    prepared.version !== 3 ||
    prepared.contractHash !== contractHash ||
    prepared.oracle !== digest(oracleSource) ||
    prepared.reference !== digest(positiveApp)
  )
    throw new Error('Stale evaluation contract');
  for (const [file, expected] of [
    ['oracle.test.tsx', digest(oracleSource)],
    ['reference.tsx', digest(positiveApp)],
  ]) {
    const source = join(base, 'protected', file);
    if (
      !(await lstat(source)).isFile() ||
      digest(await readFile(source, 'utf8')) !== expected
    )
      throw new Error('Oracle/reference tampering');
  }
  return prepared;
}

type RegressionOutcome = {
  status:
    | 'not-run'
    | 'provisional-detection'
    | 'no-capability-regression'
    | 'timeout'
    | 'tool-failure';
  assertionRegressions: string[];
  detail?: string;
};

async function counterfactualRegression(
  source: string,
  base: string,
  arm: string,
  passedAssertions: Record<string, Set<string>>,
  timeoutMs: number,
  nodeExecutable: string,
  vitestExecutable: string,
): Promise<RegressionOutcome> {
  const files = Object.keys(passedAssertions);
  if (!files.length) return { status: 'not-run', assertionRegressions: [] };
  const execution = join(
    base,
    'protected',
    `${arm}-counterfactual-${crypto.randomUUID()}`,
  );
  let stage = 'copy';
  let processOutcome = 'not-started';
  try {
    await materialize(source, execution);
    await writeFile(join(execution, 'src/OrdersApp.tsx'), negativeApp);
    const reportPath = join(execution, 'counterfactual-report.json');
    let failed = false;
    stage = 'process';
    try {
      await command(
        execution,
        [
          nodeExecutable,
          vitestExecutable,
          'run',
          '--config',
          join(execution, 'vitest.config.ts'),
          ...files,
          '--reporter=json',
          '--outputFile',
          reportPath,
        ],
        timeoutMs,
      );
      processOutcome = 'passed';
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string'
          ? error.message
          : '';
      const errorCode =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['ENOENT', 'ENOSPC', 'EMFILE', 'EACCES', 'EPERM', 'EINVAL'].includes(
          String(error.code),
        )
          ? String(error.code)
          : 'other';
      processOutcome =
        /^Trial exited (\d+|null);/.exec(message)?.[1] ??
        (message.includes('timed out')
          ? 'deadline-other'
          : `error-${typeof error}-${errorCode}`);
      if (processTimedOut(error))
        return {
          status: 'timeout',
          assertionRegressions: [],
        };
      failed = true;
    }
    stage = 'report';
    const report = await json(reportPath);
    if (
      !Array.isArray(report.testResults) ||
      !Number.isSafeInteger(report.numTotalTests) ||
      report.numTotalTests < 1 ||
      !report.testResults.every(
        (result: { assertionResults?: unknown[] }) =>
          Array.isArray(result.assertionResults) &&
          result.assertionResults.length > 0,
      )
    )
      return {
        status: 'tool-failure',
        assertionRegressions: [],
        detail: 'report-shape',
      };
    if (
      report.testResults.some(
        (result: {
          assertionResults: Array<{ failureMessages?: unknown[] }>;
        }) =>
          result.assertionResults.some((assertion) =>
            assertion.failureMessages?.some(
              (message) =>
                typeof message === 'string' &&
                /^(?:Error: )?Test timed out in \d+ms/.test(message),
            ),
          ),
      )
    )
      return { status: 'timeout', assertionRegressions: [] };
    const assertionRegressions = files.filter((path) =>
      report.testResults.some(
        (result: {
          name?: string;
          assertionResults?: Array<{
            fullName?: string;
            status?: string;
            failureMessages?: unknown[];
          }>;
        }) =>
          result?.name === join(execution, path) &&
          Array.isArray(result.assertionResults) &&
          result.assertionResults.some(
            (assertion) =>
              typeof assertion.fullName === 'string' &&
              passedAssertions[path].has(assertion.fullName) &&
              assertion.status === 'failed' &&
              Array.isArray(assertion.failureMessages) &&
              assertion.failureMessages.some(
                (message) =>
                  typeof message === 'string' &&
                  /^AssertionError:/.test(message),
              ),
          ),
      ),
    );
    return {
      status:
        failed && assertionRegressions.length
          ? 'provisional-detection'
          : failed
            ? 'tool-failure'
            : 'no-capability-regression',
      assertionRegressions: failed ? assertionRegressions : [],
      ...(failed && !assertionRegressions.length
        ? { detail: 'non-assertion-failure' }
        : {}),
    };
  } catch (error) {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ['ENOENT', 'ENOSPC', 'EMFILE', 'EACCES'].includes(String(error.code))
        ? String(error.code)
        : 'other';
    return {
      status: 'tool-failure',
      assertionRegressions: [],
      detail: `${stage}-${code}-${processOutcome}`,
    };
  } finally {
    await rm(execution, { recursive: true, force: true });
  }
}

async function checks(
  base: string,
  arm: string,
  original: Record<string, string>,
  reference = false,
  timeoutMs = 30_000,
  counterfactualTimeoutMs = timeoutMs,
  skipCounterfactual = false,
) {
  const source = join(base, arm);
  const snapshot = await migrationSnapshot(source);
  const hashes = {
    originalFixture: digest(JSON.stringify(original)),
    submitted: digest(JSON.stringify(snapshot)),
    submittedSource: digest(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(snapshot).filter(([path]) => path.startsWith('src/')),
        ),
      ),
    ),
    sdk: digest(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(snapshot).filter(
            ([path]) =>
              (path.startsWith('vendor/') ||
                path.startsWith('node_modules/@maelstrom-co/')) &&
              !path.includes('/skills/'),
          ),
        ),
      ),
    ),
  };
  const changed = Object.keys(original).filter(
    (path) => snapshot[path] !== original[path],
  );
  const unexpected = Object.keys(snapshot).filter(
    (path) => !original[path] && !/^src\/[\w.-]+(?:\.test)?\.tsx?$/.test(path),
  );
  const immutable = changed.filter((path) => path !== 'src/OrdersApp.tsx');
  if (immutable.length || unexpected.length)
    return {
      hashes,
      functionalOutcomes: null,
      preserved: false,
      functional: false,
      typecheck: false,
      lint: false,
      tests: false,
      addedRegressionTests: [],
      executedRegressionTests: [],
      regression: {
        status: 'not-run',
        assertionRegressions: [],
      } as RegressionOutcome,
      changed,
      immutable,
      unexpected,
    };
  const execution = join(
    base,
    'protected',
    `${arm}-${reference ? 'reference' : 'execution'}-${crypto.randomUUID()}`,
  );
  await materialize(source, execution);
  if (reference)
    await writeFile(join(execution, 'src/OrdersApp.tsx'), positiveApp);
  await writeFile(join(execution, 'oracle.test.tsx'), oracleSource);
  // Resolve only fixed trusted tools. Never read or run consumer package scripts.
  const executionChecks: string[] = [];
  const run = async (args: string[]) => {
    try {
      await command(execution, args, timeoutMs);
      executionChecks.push('passed');
      return true;
    } catch (error) {
      executionChecks.push(processTimedOut(error) ? 'timeout' : 'failed');
      return false;
    }
  };
  const nodeExecutable = await realpath(Bun.which('node') ?? '/usr/bin/node');
  const vitestExecutable = await safeBin('vitest');
  const typecheck = await run([
    nodeExecutable,
    await safeBin('tsc'),
    '--noEmit',
    '-p',
    join(execution, 'tsconfig.json'),
  ]);
  const lint = await run([
    nodeExecutable,
    await safeBin('biome'),
    'check',
    'src',
  ]);
  const testReport = join(execution, 'test-report.json');
  const testProcess = await run([
    nodeExecutable,
    vitestExecutable,
    'run',
    '--config',
    join(execution, 'vitest.config.ts'),
    '--exclude',
    'oracle.test.tsx',
    '--reporter=json',
    '--outputFile',
    testReport,
  ]);
  let tests = false;
  const addedRegressionTests = Object.keys(snapshot).filter(
    (path) => !original[path] && /\.test\.tsx?$/.test(path),
  );
  let executedRegressionTests: string[] = [];
  const passedAssertions: Record<string, Set<string>> = {};
  try {
    const report = await json(testReport);
    tests =
      testProcess &&
      report.success === true &&
      Number.isSafeInteger(report.numTotalTests) &&
      report.numTotalTests > 0;
    if (tests && Array.isArray(report.testResults))
      executedRegressionTests = addedRegressionTests.filter((path) =>
        report.testResults.some(
          (result: {
            name?: string;
            assertionResults?: Array<{ status?: string }>;
          }) =>
            result?.name === join(execution, path) &&
            Array.isArray(result.assertionResults) &&
            result.assertionResults.some(
              (assertion) => assertion?.status === 'passed',
            ),
        ),
      );
    for (const path of executedRegressionTests) {
      const result = report.testResults.find(
        (result: { name?: string }) => result?.name === join(execution, path),
      );
      passedAssertions[path] = new Set(
        result.assertionResults
          .filter(
            (assertion: { fullName?: string; status?: string }) =>
              assertion.status === 'passed' &&
              typeof assertion.fullName === 'string' &&
              assertion.fullName.length < 4096,
          )
          .map((assertion: { fullName: string }) => assertion.fullName),
      );
    }
  } catch {}
  const reportPath = join(execution, 'oracle-report.json');
  const oracleProcess = await run([
    nodeExecutable,
    vitestExecutable,
    'run',
    '--config',
    join(execution, 'vitest.config.ts'),
    'oracle.test.tsx',
    '--reporter=json',
    '--outputFile',
    reportPath,
  ]);
  let functionalOutcomes: Record<string, boolean> | null = null;
  try {
    const report = await json(reportPath);
    const assertions = Array.isArray(report.testResults)
      ? report.testResults.flatMap((item: { assertionResults?: unknown[] }) =>
          Array.isArray(item?.assertionResults) ? item.assertionResults : [],
        )
      : [];
    if (assertions.length === oracleCriteria.length)
      functionalOutcomes = Object.fromEntries(
        oracleCriteria.map((name) => [
          name,
          assertions.filter(
            (item: { fullName?: string; status?: string }) =>
              item?.fullName === name && item.status === 'passed',
          ).length === 1,
        ]),
      );
  } catch {
    /* Never print untrusted test diagnostics. */
  }
  const functional =
    oracleProcess &&
    functionalOutcomes !== null &&
    Object.values(functionalOutcomes).every(Boolean);
  const regression: RegressionOutcome =
    !skipCounterfactual && tests
      ? await counterfactualRegression(
          source,
          base,
          arm,
          passedAssertions,
          counterfactualTimeoutMs,
          nodeExecutable,
          vitestExecutable,
        )
      : { status: 'not-run', assertionRegressions: [] };
  const after = await migrationSnapshot(source);
  await rm(execution, { recursive: true, force: true });
  return {
    hashes,
    functionalOutcomes,
    executionChecks: Object.fromEntries(
      ['typecheck', 'lint', 'tests', 'functional'].map((name, index) => [
        name,
        executionChecks[index],
      ]),
    ),
    preserved: JSON.stringify(snapshot) === JSON.stringify(after),
    functional,
    typecheck,
    lint,
    tests,
    addedRegressionTests,
    executedRegressionTests,
    regression,
    changed,
    immutable,
    unexpected,
  };
}

export async function evaluateMigration(
  base: string,
  seal: string,
  unsafe: boolean,
  traces: string[] = [],
  selfCheck = false,
  timeoutMs = 30_000,
  counterfactualTimeoutMs = timeoutMs,
  reviewFile?: string,
) {
  if (!unsafe)
    throw new Error(
      'Evaluation executes untrusted code. Supply --unsafe-execute only in a disposable isolated environment. This runner is not a sandbox.',
    );
  if (!(await lstat(base)).isDirectory())
    throw new Error('Evidence root must be a regular directory');
  base = await realpath(base);
  const prepared = await verifyPrepared(base, seal);
  const results: Array<
    Awaited<ReturnType<typeof checks>> &
      ReturnType<typeof piEvidence> & {
        arm: string;
        automatedPassed: boolean;
        passed: boolean;
        reviewApproved: boolean;
        reviewHash: string | null;
      }
  > = [];
  for (const [index, arm] of ['baseline', 'treatment'].entries()) {
    const result = await checks(
      base,
      arm,
      prepared.snapshots[arm],
      selfCheck && arm === 'treatment',
      timeoutMs,
      counterfactualTimeoutMs,
      selfCheck,
    );
    let trace = piEvidence('');
    if (traces[index])
      try {
        trace = piEvidence(await boundedText(traces[index]), {
          cwd: join(base, arm),
          prompt,
          guides: prepared.guideEvidence[arm],
          exposureGuides: prepared.guideEvidence.treatment,
        });
      } catch {
        trace = { ...piEvidence(''), traceStatus: 'invalid' };
      }
    results.push({
      arm,
      ...result,
      ...trace,
      automatedPassed:
        result.preserved &&
        result.functional &&
        result.typecheck &&
        result.lint &&
        result.tests &&
        (selfCheck || result.regression.status === 'provisional-detection'),
      passed: false,
      reviewApproved: false,
      reviewHash: null,
    });
  }
  let reviewText: string | undefined;
  if (reviewFile) {
    if (!reviewFile.endsWith('.review.json'))
      throw new Error('External review must use a .review.json file');
    const info = await lstat(reviewFile);
    if (!info.isFile() || info.size > 16_384)
      throw new Error('Invalid external review file');
    reviewText = await readFile(reviewFile, 'utf8');
  }
  const review = migrationReview(reviewText, seal, {
    baseline: { sourceHash: results[0].hashes.submittedSource },
    treatment: { sourceHash: results[1].hashes.submittedSource },
  });
  for (const result of results) {
    result.reviewApproved = review.status === 'approved';
    result.reviewHash = review.reviewHash;
    result.passed =
      result.automatedPassed && (selfCheck || result.reviewApproved);
  }
  await verifyPrepared(base, seal);
  const selfCheckVerified =
    selfCheck &&
    results[0].preserved &&
    results[0].typecheck &&
    results[0].lint &&
    results[0].tests &&
    !results[0].functional &&
    results[1].passed;
  return {
    version: 3,
    provenance: prepared.provenance,
    seal,
    oracleHash: prepared.oracle,
    matchedRuntimeHash: prepared.matchedRuntimeHash,
    selfCheck,
    selfCheckVerified,
    results,
    review,
    qualityStatus: selfCheck
      ? 'trusted-preflight'
      : results.every((result) => result.passed)
        ? 'approved'
        : !results.every((result) => result.automatedPassed)
          ? 'automated-failure'
          : review.status === 'pending'
            ? 'pending-review'
            : `review-${review.status}`,
    processEvidence: await migrationProcessEvidenceDirectory(),
    comparison: selfCheck
      ? { eligible: false, savings: null }
      : compareMigration(results[0], results[1]),
  };
}

if (import.meta.main) {
  try {
    const [action, ...args] = process.argv.slice(2);
    if (!action || action === 'help')
      console.log(
        'skills:eval prepare <new-directory>\nskills:eval evaluate <directory> <prepare-seal> --unsafe-execute [baseline.pi.jsonl treatment.pi.jsonl] [--review <file.review.json>]\nskills:eval self-check <directory> <prepare-seal> --unsafe-execute\nCounterfactual assertion failures are provisional. Approval requires independent behavioral review of both sealed source submissions. Keep protected/ inaccessible to external agents. Unsafe evaluation has no filesystem/network isolation. No model launcher or credentials are used.',
      );
    else if (action === 'prepare' && args.length === 1)
      console.log(JSON.stringify(await prepareMigration(args[0]), null, 2));
    else if (
      (action === 'evaluate' && [2, 3, 5, 7].includes(args.length)) ||
      (action === 'self-check' && [2, 3].includes(args.length))
    ) {
      const reviewIndex = args.indexOf('--review');
      if (
        reviewIndex >= 0 &&
        (action !== 'evaluate' || reviewIndex !== args.length - 2)
      )
        throw new Error('Invalid review argument');
      const traceArgs = args.slice(
        3,
        reviewIndex >= 0 ? reviewIndex : undefined,
      );
      if (traceArgs.length !== 0 && traceArgs.length !== 2)
        throw new Error('Trace files must be supplied as a pair');
      console.log(
        JSON.stringify(
          await evaluateMigration(
            resolve(args[0]),
            args[1],
            args[2] === '--unsafe-execute',
            traceArgs,
            action === 'self-check',
            30_000,
            30_000,
            args.at(-2) === '--review' ? args.at(-1) : undefined,
          ),
          null,
          2,
        ),
      );
    } else throw new Error('Invalid arguments; use help');
  } catch {
    console.error(
      'Migration evaluation failed. Check inputs and integrity; use help. Raw evidence is never printed.',
    );
    process.exitCode = 1;
  }
}
