import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { buildCaseInput } from './cases';
import {
  type CandidateGrade,
  diff,
  gradeCandidate,
  runCommand,
  snapshotCandidate,
} from './index';

type CaseId = 'onboarding-implementation' | 'react-conversion';
type Overlay = { path: string; source?: string };
const calibration = join(import.meta.dir, 'fixtures/calibration');

/** Runs deterministic known-good and known-bad application calibrations against a clean prepared trial tree. */
export async function calibrateCases(
  trialRoot: string,
): Promise<{ label: string; result: CandidateGrade }[]> {
  await verifyPreparedSources(
    'onboarding-implementation',
    join(trialRoot, 'onboarding'),
  );
  await verifyPreparedSources(
    'react-conversion',
    join(trialRoot, 'migration-conversion'),
  );
  const backupRoot = await mkdtemp(
    join(tmpdir(), 'maelstrom-grade-calibration-'),
  );
  const results: { label: string; result: CandidateGrade }[] = [];
  let sequence = 0;
  const run = async (
    caseId: CaseId,
    project: string,
    overlays: Overlay[],
    label: string,
  ) => {
    const root = join(trialRoot, project);
    const baseline = await snapshotCandidate(root);
    const backups: { target: string; backup: string; existed: boolean }[] = [];
    try {
      for (const overlay of overlays) {
        const target = join(root, overlay.path);
        const backup = join(backupRoot, `restore-${sequence++}`);
        let existed = false;
        try {
          await copyFile(target, backup);
          existed = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        backups.push({ target, backup, existed });
        if (overlay.source) await copyFile(overlay.source, target);
        else await rm(target, { force: true });
      }
      results.push({
        label,
        result: await gradeCandidate(caseId, {
          candidateRoot: root,
          baseline,
          timeoutMs: 90_000,
        }),
      });
    } finally {
      for (const backup of backups.reverse()) {
        if (backup.existed) await copyFile(backup.backup, backup.target);
        else await rm(backup.target, { force: true });
      }
    }
  };

  try {
    for (const name of [
      'onboarding-good',
      'onboarding-renamed-ids',
      'onboarding-collapsed',
      'onboarding-invisible',
      'onboarding-unregistered',
      'onboarding-invalid-sdk',
      'onboarding-no-sdk',
      'onboarding-wrong-ticket-status',
      'onboarding-missing-ticket-status',
    ]) {
      await run(
        'onboarding-implementation',
        'onboarding',
        [
          {
            path: 'src/App.tsx',
            source: join(calibration, name, 'src/App.tsx'),
          },
        ],
        name,
      );
    }
    for (const name of [
      'react-conversion-good',
      'react-conversion-whitespace',
      'react-conversion-pending',
      'react-conversion-controlled',
      'react-conversion-error',
      'react-conversion-success',
      'react-conversion-handler',
    ]) {
      const overlays: Overlay[] = [
        {
          path: 'src/App.tsx',
          source: join(calibration, 'react-conversion-good/src/App.tsx'),
        },
      ];
      if (name !== 'react-conversion-good')
        overlays.push({
          path: 'src/SearchPanel.tsx',
          source: join(calibration, name, 'src/SearchPanel.tsx'),
        });
      await run('react-conversion', 'migration-conversion', overlays, name);
    }
    await run(
      'react-conversion',
      'migration-conversion',
      [
        {
          path: 'src/App.tsx',
          source: join(calibration, 'react-conversion-renamed-ids/src/App.tsx'),
        },
      ],
      'react-conversion-renamed-ids',
    );
    await run(
      'react-conversion',
      'migration-conversion',
      [
        {
          path: 'src/App.tsx',
          source: join(calibration, 'react-conversion-good/src/App.tsx'),
        },
        { path: 'src/SearchPanel.test.tsx' },
      ],
      'react-conversion-tampered-baseline-test',
    );
    results.push({
      label: 'react-conversion-rebuild-artifacts',
      result: await runGeneratedArtifactRebuildProbe(
        join(trialRoot, 'migration-conversion'),
        backupRoot,
      ),
    });
    return results;
  } finally {
    await rm(backupRoot, { recursive: true, force: true });
  }
}

async function runGeneratedArtifactRebuildProbe(
  root: string,
  backupRoot: string,
): Promise<CandidateGrade> {
  const appPath = join(root, 'src/App.tsx');
  const distPath = join(root, 'dist');
  const viteCachePath = join(root, 'node_modules/.vite');
  const appBackup = join(backupRoot, 'artifact-probe-App.tsx');
  const distBackup = join(backupRoot, 'artifact-probe-dist');
  const cacheBackup = join(backupRoot, 'artifact-probe-vite-cache');
  const staleAsset = 'dist/assets/index-review-oldhash.js';
  const oldAssetPath = join(root, staleAsset);
  await copyFile(appPath, appBackup);
  await cp(distPath, distBackup, { recursive: true });
  let hadViteCache = false;
  try {
    await cp(viteCachePath, cacheBackup, { recursive: true });
    hadViteCache = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    await mkdir(join(root, 'dist/assets'), { recursive: true });
    await writeFile(oldAssetPath, 'old generated asset from prior build\\n');
    const baseline = await snapshotCandidate(root);
    const knownGoodApp = await readFile(
      join(calibration, 'react-conversion-good/src/App.tsx'),
      'utf8',
    );
    const heading = '<h1>Support workspace</h1>';
    if (!knownGoodApp.includes(heading))
      throw new Error(
        'Known-good conversion fixture heading changed unexpectedly',
      );
    await writeFile(
      appPath,
      knownGoodApp.replace(
        heading,
        '<h1 data-evaluation-build-probe="rebuilt">Support workspace</h1>',
      ),
    );
    const probeCommands: CandidateGrade['commands'] = [];
    for (const script of ['build', 'test']) {
      const result = await runCommand({
        command: { executable: 'bun', args: ['run', script] },
        input: '',
        cwd: root,
        timeoutMs: 90_000,
      });
      probeCommands.push({
        command: ['bun', 'run', script],
        status: result.spawnError
          ? 'spawn-error'
          : result.timedOut
            ? 'timeout'
            : result.cancelled
              ? 'cancelled'
              : 'completed',
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        durationMs: result.durationMs,
        ...(result.spawnError ? { spawnError: result.spawnError } : {}),
        summary:
          `${result.stderr.slice(-1000)}${result.stdout.slice(-1000)}`.trim(),
      });
    }
    const afterChecks = await snapshotCandidate(root);
    const checkChanges = diff(baseline, afterChecks);
    const oldAssetDeleted = checkChanges.some(
      (change) => change.path === staleAsset && change.kind === 'deleted',
    );
    const newBuildAssets = checkChanges.filter(
      (change) =>
        change.path.startsWith('dist/assets/') &&
        change.kind === 'added' &&
        /\.(?:js|css)$/.test(change.path),
    );
    const grade = await gradeCandidate('react-conversion', {
      candidateRoot: root,
      baseline,
      timeoutMs: 90_000,
    });
    const buildPassed =
      probeCommands[0]?.exitCode === 0 && !probeCommands[0]?.timedOut;
    const testPassed =
      probeCommands[1]?.exitCode === 0 && !probeCommands[1]?.timedOut;
    grade.criteria.push(
      {
        id: 'allowed-build-command',
        status: buildPassed ? 'passed' : 'failed',
        evidence: `bun run build exit=${probeCommands[0]?.exitCode ?? 'missing'}; timeout=${probeCommands[0]?.timedOut ?? 'unknown'}`,
      },
      {
        id: 'allowed-test-command',
        status: testPassed ? 'passed' : 'failed',
        evidence: `bun run test exit=${probeCommands[1]?.exitCode ?? 'missing'}; timeout=${probeCommands[1]?.timedOut ?? 'unknown'}`,
      },
      {
        id: 'dist-old-asset-pruned',
        status: oldAssetDeleted ? 'passed' : 'failed',
        evidence: oldAssetDeleted
          ? `The pre-existing ${staleAsset} was removed by the production build.`
          : `The old ${staleAsset} was not observed as deleted.`,
      },
      {
        id: 'dist-build-assets-added',
        status: newBuildAssets.length ? 'passed' : 'failed',
        evidence: `${newBuildAssets.length} new JS/CSS build asset(s) were observed: ${newBuildAssets.map(({ path }) => path).join(', ') || 'none'}.`,
      },
    );
    grade.commands.unshift(...probeCommands);
    return grade;
  } finally {
    await copyFile(appBackup, appPath);
    await rm(distPath, { recursive: true, force: true });
    await cp(distBackup, distPath, { recursive: true });
    await rm(viteCachePath, { recursive: true, force: true });
    if (hadViteCache) await cp(cacheBackup, viteCachePath, { recursive: true });
  }
}

export async function verifyPreparedSources(caseId: CaseId, root: string) {
  const context = await buildCaseInput(caseId);
  const expectedSources = new Set(['src/main.tsx']);
  for (const fixture of context.fixtureFiles) {
    if (
      fixture.path.startsWith('package.json (staged from package.json.fixture)')
    ) {
      const source = JSON.parse(fixture.text);
      await assertRegularFile(
        join(root, 'package.json'),
        `${caseId}:package.json`,
      );
      const actualText = await readFile(join(root, 'package.json'), 'utf8');
      const expectedManifest = expectedPreparedManifest(source);
      const expectedText = `${JSON.stringify(expectedManifest, null, 2)}\n`;
      const actual = JSON.parse(actualText);
      if (
        !isDeepStrictEqual(actual, expectedManifest) ||
        actualText !== expectedText
      )
        throw new Error(
          `Prepared trial metadata differs from trusted preparation contract: ${caseId}:package.json`,
        );
      continue;
    }
    const path = fixture.path.replace(/ \([^)]*\)$/, '');
    await assertRegularFile(join(root, path), `${caseId}:${path}`);
    const actual = await readFile(join(root, path), 'utf8');
    if (actual !== fixture.text)
      throw new Error(
        `Prepared trial baseline differs from trusted fixture: ${caseId}:${path}`,
      );
    if (path.startsWith('src/')) expectedSources.add(path);
  }
  const fixtureProject =
    caseId === 'onboarding-implementation'
      ? 'onboarding-react'
      : 'migration-react';
  const immutableFiles = [
    'src/main.tsx',
    'index.html',
    'tsconfig.json',
    'vite.config.ts',
  ];
  for (const path of immutableFiles) {
    await assertRegularFile(join(root, path), `${caseId}:${path}`);
    const expected = await readFile(
      join(import.meta.dir, `../acceptance/fixtures/${fixtureProject}`, path),
      'utf8',
    );
    const actual = await readFile(join(root, path), 'utf8');
    if (actual !== expected)
      throw new Error(
        `Prepared trial baseline differs from trusted fixture: ${caseId}:${path}`,
      );
  }
  await assertRegularTree(join(root, 'src'), `${caseId}:src`);
  const actualSources = await collectSourcePaths(join(root, 'src'));
  const unexpected = actualSources.filter((path) => !expectedSources.has(path));
  const missing = [...expectedSources].filter(
    (path) => !actualSources.includes(path),
  );
  if (unexpected.length || missing.length)
    throw new Error(
      `Prepared trial source tree is not pristine for ${caseId}: unexpected=${unexpected.join(',') || 'none'} missing=${missing.join(',') || 'none'}`,
    );
  const fixtureSupportRoot = join(
    import.meta.dir,
    '../acceptance/fixtures/migration-react/.trial',
  );
  const actualSupportRoot = join(root, '.trial');
  await assertRegularTree(actualSupportRoot, `${caseId}:.trial`);
  const expectedSupport = (await collectTreePaths(fixtureSupportRoot)).sort();
  const actualSupport = (await collectTreePaths(actualSupportRoot)).sort();
  if (!isDeepStrictEqual(actualSupport, expectedSupport))
    throw new Error(
      `Prepared trial support tree differs from trusted fixture: ${caseId}:.trial`,
    );
  for (const path of expectedSupport) {
    const expected = await readFile(join(fixtureSupportRoot, path), 'utf8');
    const actual = await readFile(join(actualSupportRoot, path), 'utf8');
    if (actual !== expected)
      throw new Error(
        `Prepared trial support file differs from trusted fixture: ${caseId}:.trial/${path}`,
      );
  }
}

export function expectedPreparedManifest(source: Record<string, unknown>) {
  const manifest = structuredClone(source) as {
    dependencies: Record<string, string>;
    devDependencies?: Record<string, string>;
    overrides?: Record<string, string>;
  };
  const sdkNames = ['protocol', 'connectors', 'client', 'react'];
  const version = '0.1.0-alpha.4';
  const sdkDeps = Object.fromEntries(
    sdkNames.map((name) => [
      `@maelstrom-co/${name}`,
      `file:./vendor/maelstrom-co-${name}-${version}.tgz`,
    ]),
  );
  Object.assign(manifest.dependencies, sdkDeps);
  const pinned: Record<string, string> = {
    react: '19.2.8',
    'react-dom': '19.2.8',
    '@tanstack/react-store': '0.9.3',
    '@tanstack/store': '0.9.3',
    '@types/react': '19.2.18',
    '@types/react-dom': '19.2.4',
    '@vitejs/plugin-react': '5.2.0',
    typescript: '5.9.3',
    vite: '8.2.1',
    '@testing-library/react': '16.3.2',
    '@testing-library/dom': '10.4.1',
    '@testing-library/jest-dom': '6.9.1',
    jsdom: '27.3.0',
    vitest: '4.1.9',
  };
  for (const [name, value] of Object.entries(pinned)) {
    if (Object.hasOwn(manifest.dependencies, name))
      manifest.dependencies[name] = value;
    else {
      manifest.devDependencies ??= {};
      manifest.devDependencies[name] = value;
    }
  }
  manifest.overrides = sdkDeps;
  return manifest;
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile())
    throw new Error(`Prepared trial input is not a regular file: ${label}`);
}

async function assertRegularTree(path: string, label: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(
      `Prepared trial input is not a regular directory: ${label}`,
    );
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    const childInfo = await lstat(child);
    if (childInfo.isSymbolicLink())
      throw new Error(
        `Prepared trial input contains a symlink: ${label}/${entry.name}`,
      );
    if (childInfo.isDirectory())
      await assertRegularTree(child, `${label}/${entry.name}`);
    else if (!childInfo.isFile())
      throw new Error(
        `Prepared trial input is not a regular file: ${label}/${entry.name}`,
      );
  }
}

async function collectTreePaths(
  root: string,
  current = root,
): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory())
      paths.push(...(await collectTreePaths(root, path)));
    else paths.push(relative(root, path).split('\\').join('/'));
  }
  return paths;
}

async function collectSourcePaths(
  root: string,
  current = root,
): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory())
      paths.push(...(await collectSourcePaths(root, path)));
    else paths.push(relative(root, path).split('\\').join('/'));
  }
  return paths.map((path) => `src/${path}`);
}

if (import.meta.main) {
  const trialRoot = process.argv[2];
  if (!trialRoot)
    throw new Error(
      'Usage: bun apps/docs/prompts/evaluation/calibrate-cases.ts PREPARED_TRIAL_ROOT',
    );
  const results = await calibrateCases(resolve(trialRoot));
  const expected: [string, string, string][] = [
    ['onboarding-good', 'sdk-typecheck', 'passed'],
    ['onboarding-good', 'browser-chart-vessel', 'passed'],
    ['onboarding-good', 'application-change-allowlist', 'passed'],
    ['onboarding-renamed-ids', 'sdk-typecheck', 'passed'],
    ['onboarding-renamed-ids', 'browser-chart-vessel', 'passed'],
    ['onboarding-renamed-ids', 'application-change-allowlist', 'passed'],
    ['onboarding-collapsed', 'browser-chart-vessel', 'failed'],
    ['onboarding-invisible', 'browser-chart-vessel', 'failed'],
    ['onboarding-unregistered', 'browser-chart-vessel', 'failed'],
    ['onboarding-invalid-sdk', 'sdk-typecheck', 'failed'],
    ['onboarding-no-sdk', 'browser-chart-vessel', 'failed'],
    ['onboarding-wrong-ticket-status', 'browser-chart-vessel', 'failed'],
    ['onboarding-missing-ticket-status', 'browser-chart-vessel', 'failed'],
    ['react-conversion-good', 'sdk-typecheck', 'passed'],
    ['react-conversion-good', 'trusted-ui-behavior', 'passed'],
    ['react-conversion-good', 'browser-chart-vessel', 'passed'],
    ['react-conversion-renamed-ids', 'sdk-typecheck', 'passed'],
    ['react-conversion-renamed-ids', 'trusted-ui-behavior', 'passed'],
    ['react-conversion-renamed-ids', 'browser-chart-vessel', 'passed'],
    ['react-conversion-renamed-ids', 'application-change-allowlist', 'passed'],
    ['react-conversion-whitespace', 'trusted-ui-behavior', 'failed'],
    ['react-conversion-pending', 'trusted-ui-behavior', 'failed'],
    ['react-conversion-controlled', 'trusted-ui-behavior', 'failed'],
    ['react-conversion-error', 'trusted-ui-behavior', 'failed'],
    ['react-conversion-success', 'trusted-ui-behavior', 'failed'],
    ['react-conversion-handler', 'trusted-ui-behavior', 'failed'],
    [
      'react-conversion-tampered-baseline-test',
      'trusted-file-integrity',
      'failed',
    ],
    ['react-conversion-rebuild-artifacts', 'allowed-build-command', 'passed'],
    ['react-conversion-rebuild-artifacts', 'allowed-test-command', 'passed'],
    ['react-conversion-rebuild-artifacts', 'dist-old-asset-pruned', 'passed'],
    ['react-conversion-rebuild-artifacts', 'dist-build-assets-added', 'passed'],
    [
      'react-conversion-rebuild-artifacts',
      'application-change-allowlist',
      'passed',
    ],
    ['react-conversion-rebuild-artifacts', 'sdk-typecheck', 'passed'],
    ['react-conversion-rebuild-artifacts', 'trusted-ui-behavior', 'passed'],
    ['react-conversion-rebuild-artifacts', 'browser-chart-vessel', 'passed'],
  ];
  const failures: string[] = [];
  for (const [label, criterion, status] of expected) {
    const result = results.find((entry) => entry.label === label)?.result;
    if (
      result?.criteria.find((item) => item.id === criterion)?.status !== status
    )
      failures.push(`${label} did not ${status} ${criterion}`);
  }
  const tampered = results.find(
    ({ label }) => label === 'react-conversion-tampered-baseline-test',
  )?.result;
  if (tampered?.harnessStatus !== 'blocked' || tampered.commands.length)
    failures.push(
      'tampered baseline grader inputs were not blocked before executable checks',
    );
  console.log(
    JSON.stringify(
      {
        calibrationOnly: true,
        candidates: results.map(({ label, result }) => ({
          label,
          harnessStatus: result.harnessStatus,
          criteria: result.criteria.map(({ id, status, evidence }) => ({
            id,
            status,
            evidence: evidence.slice(0, 2000),
          })),
          commands: result.commands.map(
            ({ command, status, exitCode, timedOut, durationMs, summary }) => ({
              command,
              status,
              exitCode,
              timedOut,
              durationMs,
              processEvidence: summary.slice(-2000),
            }),
          ),
        })),
        failures,
      },
      null,
      2,
    ),
  );
  if (failures.length) process.exitCode = 1;
}
