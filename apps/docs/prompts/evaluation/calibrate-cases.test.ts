import { afterAll, beforeAll, describe, test } from 'bun:test';
import {
  cp,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  expectedPreparedManifest,
  verifyPreparedSources,
} from './calibrate-cases';

describe('prepared calibration preflight', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(import.meta.dir, '.prepared-preflight-'));
    for (const [caseId, project, sourceFixture] of [
      ['onboarding-implementation', 'onboarding', 'onboarding-react'],
      ['react-conversion', 'migration-conversion', 'migration-react'],
    ] as const) {
      const target = join(root, project);
      const fixture = join(
        import.meta.dir,
        '../acceptance/fixtures',
        sourceFixture,
      );
      await cp(fixture, target, { recursive: true });
      await rename(
        join(target, 'package.json.fixture'),
        join(target, 'package.json'),
      );
      if (caseId === 'onboarding-implementation') {
        await rename(
          join(target, 'project.json.fixture'),
          join(target, 'project.json'),
        );
        await cp(
          join(
            import.meta.dir,
            '../acceptance/fixtures/migration-react/.trial',
          ),
          join(target, '.trial'),
          { recursive: true },
        );
        await cp(
          join(
            import.meta.dir,
            '../acceptance/fixtures/migration-react/src/testConnector.ts',
          ),
          join(target, 'src/testConnector.ts'),
        );
      }
      const packageSource = await readFile(
        join(fixture, 'package.json.fixture'),
        'utf8',
      );
      await writeFile(
        join(target, 'package.json'),
        `${JSON.stringify(expectedPreparedManifest(JSON.parse(packageSource)), null, 2)}\n`,
      );
    }
  });
  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test('renamed-ID calibration fixtures differ from known-good fixtures only in Vessel and instance IDs', async () => {
    const cases = [
      {
        good: 'onboarding-good/src/App.tsx',
        renamed: 'onboarding-renamed-ids/src/App.tsx',
        replacements: [
          ['support-queue', 'queue[renamed].support'],
          ['queue-main', 'instance[renamed].queue'],
        ],
      },
      {
        good: 'react-conversion-good/src/App.tsx',
        renamed: 'react-conversion-renamed-ids/src/App.tsx',
        replacements: [
          ['ticket-search', 'search[renamed].tickets'],
          ['search-main', 'instance[renamed].search'],
        ],
      },
    ] as const;
    for (const { good, renamed, replacements } of cases) {
      let expected = await readFile(
        join(import.meta.dir, 'fixtures/calibration', good),
        'utf8',
      );
      for (const [original, replacement] of replacements) {
        if (!expected.includes(original))
          throw new Error(
            `Good calibration fixture lacks identifier ${original}`,
          );
        expected = expected.replaceAll(original, replacement);
      }
      const actual = await readFile(
        join(import.meta.dir, 'fixtures/calibration', renamed),
        'utf8',
      );
      if (actual !== expected)
        throw new Error(
          `Renamed calibration fixture changes more than Vessel/instance IDs: ${renamed}`,
        );
    }
  });

  test('accepts clean prepared onboarding and conversion projects with fixture-defined package transforms', async () => {
    await verifyPreparedSources(
      'onboarding-implementation',
      join(root, 'onboarding'),
    );
    await verifyPreparedSources(
      'react-conversion',
      join(root, 'migration-conversion'),
    );
  });

  test('rejects mutations to source, protected harness support, and expected prepared metadata', async () => {
    const cases = [
      ['onboarding-implementation', 'onboarding', 'src/testConnector.ts'],
      ['onboarding-implementation', 'onboarding', '.trial/sdk-runtime.ts'],
      ['react-conversion', 'migration-conversion', 'src/SearchPanel.test.tsx'],
      ['react-conversion', 'migration-conversion', 'vite.config.ts'],
      ['react-conversion', 'migration-conversion', 'package.json'],
    ] as const;
    for (const [caseId, project, path] of cases) {
      const target = join(root, project, path);
      const original = await readFile(target);
      try {
        await writeFile(
          target,
          Buffer.concat([original, Buffer.from('\nmutation\n')]),
        );
        let rejected = false;
        try {
          await verifyPreparedSources(caseId, join(root, project));
        } catch {
          rejected = true;
        }
        if (!rejected)
          throw new Error(`Mutation was accepted: ${caseId}:${path}`);
      } finally {
        await writeFile(target, original);
      }
    }
    const protectedPath = join(root, 'onboarding/src/testConnector.ts');
    const backupPath = `${protectedPath}.backup`;
    await rename(protectedPath, backupPath);
    try {
      await symlink('testConnector.ts.backup', protectedPath);
      let rejected = false;
      try {
        await verifyPreparedSources(
          'onboarding-implementation',
          join(root, 'onboarding'),
        );
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('Protected source symlink was accepted');
    } finally {
      await rm(protectedPath, { force: true });
      await rename(backupPath, protectedPath);
    }
  });
});
