import { expect, test } from 'bun:test';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { packedIntegrity } from './packed-integrity.ts';
import { PACKED_PACKAGE_NAMES } from './packed-manifest.ts';
import {
  createPublicationRecord,
  type PublicationRecording,
} from './publication-record.ts';

const context = {
  repository: 'maelstrom-co/maelstrom',
  runId: '1234',
  attempt: 1,
  sourceCommit: 'a'.repeat(40),
};
const target = {
  version: '1.2.3',
  registry: 'https://registry.npmjs.org',
  tag: 'latest',
};

test('only the approved metadata fields can enter a saved record', () =>
  fixture((_root, packages, options) => {
    const contextWithExtraData = {
      ...options.context,
      token: 'fixture-private-value',
    };
    createPublicationRecord(
      { ...options, context: contextWithExtraData },
      packages,
      target,
    );
    expect(readFileSync(options.path, 'utf8')).not.toContain(
      'fixture-private-value',
    );
  }));

function fixture(
  run: (
    root: string,
    packages: {
      name: string;
      version: string;
      tarball: string;
      tarballPath: string;
    }[],
    options: PublicationRecording,
  ) => void,
) {
  const root = mkdtempSync(join(tmpdir(), 'maelstrom-record-'));
  const packages = PACKED_PACKAGE_NAMES.map((name, index) => {
    const tarballPath = join(root, `${index}.tgz`);
    writeFileSync(tarballPath, `validated fixture bytes for ${name}`);
    return {
      name,
      version: target.version,
      tarball: `${index}.tgz`,
      tarballPath,
    };
  });
  try {
    run(root, packages, {
      path: join(root, 'output', 'publication-record.json'),
      context,
      freshVersion: false,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('records package bytes and acceptance without storing local paths or declaring availability', () =>
  fixture((_root, packages, options) => {
    const record = createPublicationRecord(options, packages, target);
    expect(record.accepted(packages[0]!.name)).toBe(false);
    record.set(packages[0]!.name, 'in_flight');
    record.set(packages[0]!.name, 'accepted');
    expect(record.integrity(packages[0]!.name)).toBe(
      packedIntegrity(packages[0]!),
    );
    const text = readFileSync(options.path, 'utf8');
    const saved = JSON.parse(text);
    expect(saved.packages[0].state).toBe('accepted');
    expect(saved.packages[1].state).toBe('not_attempted');
    expect(text).not.toContain(packages[0]!.tarballPath);
    expect(saved).not.toHaveProperty('available');
  }));

test.each(['flat', 'nested'])(
  'restores accepted memory from the %s artifact download layout',
  (layout) =>
    fixture((root, packages, options) => {
      const first = createPublicationRecord(options, packages, target);
      first.set(packages[0]!.name, 'accepted');
      const recoveryDirectory = join(root, 'recovery');
      const destination =
        layout === 'flat'
          ? recoveryDirectory
          : join(recoveryDirectory, 'npm-publication-records-1');
      mkdirSync(destination, { recursive: true });
      copyFileSync(options.path, join(destination, 'publication-record.json'));
      const second = createPublicationRecord(
        {
          ...options,
          path: join(root, 'second.json'),
          recoveryDirectory,
          context: { ...context, attempt: 2 },
        },
        packages,
        target,
      );
      expect(second.accepted(packages[0]!.name)).toBe(true);
      expect(second.accepted(packages[1]!.name)).toBe(false);
      expect(second.requiresReconciliation).toBe(true);
    }),
);

test('rejects a changed tarball before writing a recovery snapshot', () =>
  fixture((root, packages, options) => {
    createPublicationRecord(options, packages, target);
    writeFileSync(packages[0]!.tarballPath, 'different bytes');
    expect(() =>
      createPublicationRecord(
        {
          ...options,
          path: join(root, 'second.json'),
          recoveryDirectory: join(root, 'output'),
          context: { ...context, attempt: 2 },
        },
        packages,
        target,
      ),
    ).toThrow('checksum');
  }));

test.each([
  'repository',
  'runId',
  'sourceCommit',
  'attempt',
  'registry',
  'extra',
  'duplicate',
  'name',
])('rejects a recovery record with a mismatched or malformed %s', (field) =>
  fixture((root, packages, options) => {
    createPublicationRecord(options, packages, target);
    const saved = JSON.parse(readFileSync(options.path, 'utf8'));
    if (field === 'repository') saved.repository = 'other/repository';
    if (field === 'runId') saved.runId = '999';
    if (field === 'sourceCommit') saved.sourceCommit = 'b'.repeat(40);
    if (field === 'attempt') saved.attempt = 2;
    if (field === 'registry')
      saved.registry = 'https://secret:password@registry.npmjs.org';
    if (field === 'extra') saved.token = 'must not be accepted';
    if (field === 'duplicate') saved.packages[1] = saved.packages[0];
    if (field === 'name') saved.packages[0].name = '@unrelated/package';
    writeFileSync(options.path, JSON.stringify(saved));
    expect(() =>
      createPublicationRecord(
        {
          ...options,
          path: join(root, 'second.json'),
          recoveryDirectory: join(root, 'output'),
          context: { ...context, attempt: 2 },
        },
        packages,
        target,
      ),
    ).toThrow();
  }),
);

test('an older accepted upload cannot be erased by a later not-attempted snapshot', () =>
  fixture((root, packages, options) => {
    const first = createPublicationRecord(options, packages, target);
    first.set(packages[0]!.name, 'accepted');
    const recoveryDirectory = join(root, 'recovery');
    for (const attempt of [1, 2]) {
      const directory = join(
        recoveryDirectory,
        `npm-publication-records-${attempt}`,
      );
      mkdirSync(directory, { recursive: true });
      const saved = JSON.parse(readFileSync(options.path, 'utf8'));
      saved.attempt = attempt;
      if (attempt === 2) saved.packages[0].state = 'not_attempted';
      writeFileSync(
        join(directory, 'publication-record.json'),
        JSON.stringify(saved),
      );
    }
    expect(() =>
      createPublicationRecord(
        {
          ...options,
          path: join(root, 'third.json'),
          recoveryDirectory,
          context: { ...context, attempt: 3 },
        },
        packages,
        target,
      ),
    ).toThrow('downgrade');
  }));

test('missing records do not clear uncertainty on a rerun', () =>
  fixture((root, packages, options) => {
    const record = createPublicationRecord(
      {
        ...options,
        recoveryDirectory: join(root, 'missing'),
        context: { ...context, attempt: 3 },
      },
      packages,
      target,
    );
    expect(record.requiresReconciliation).toBe(true);
  }));

test('recovery rejects symlinked record files', () =>
  fixture((root, packages, options) => {
    createPublicationRecord(options, packages, target);
    const recoveryDirectory = join(root, 'recovery');
    mkdirSync(recoveryDirectory);
    symlinkSync(
      options.path,
      join(recoveryDirectory, 'publication-record.json'),
    );
    expect(() =>
      createPublicationRecord(
        {
          ...options,
          path: join(root, 'second.json'),
          recoveryDirectory,
          context: { ...context, attempt: 2 },
        },
        packages,
        target,
      ),
    ).toThrow('Unexpected');
  }));
