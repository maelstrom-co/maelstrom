import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readBoundedFile } from './lib/bounded-file.ts';
import {
  type ArchiveProcessRequest,
  type ArchiveProcessResult,
  PACKED_MANIFEST_FILENAME,
  type ValidatedPackedPackage,
  validatePackedManifest,
} from './lib/packed-manifest.ts';
import {
  createPublicationRecord,
  type PublicationRecording,
} from './lib/publication-record.ts';
import {
  authenticationFailureHint,
  hasPublishedIntegrity,
  hasPublishedPackage,
  isAlreadyPublished,
  resolveRegistry,
} from './lib/registry.ts';

// The publishing half of the release. It runs in the only job that holds a
// npm publishing identity, and it deliberately does nothing that could execute
// dependency or package code: no install, no build, no project graph. The
// complete artifact collection is validated before any registry interaction.

export type PublishOptions = {
  dir: string;
  tag: string;
  registry: string;
  expectedVersion: string;
  dryRun: boolean;
  provenance: boolean;
  skipPublished: boolean;
  requireExisting?: boolean;
  recording?: PublicationRecording;
};

type PublishDependencies = {
  runArchiveProcess?: (request: ArchiveProcessRequest) => ArchiveProcessResult;
  isAlreadyPublished?: typeof isAlreadyPublished;
  hasPublishedPackage?: typeof hasPublishedPackage;
  hasPublishedIntegrity?: typeof hasPublishedIntegrity;
  publish?: (
    tarball: string,
    pkg: ValidatedPackedPackage,
    options: PublishOptions,
  ) => void;
};

const CANONICAL_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Parses trusted command-line authority before artifact reads or registry
 * probes. The expected version must use the separate canonical
 * `--expected-version VALUE` form exactly once; artifact metadata can never
 * supply or override it.
 */
export function parsePublishArgs(
  argv: string[],
  cwd = process.cwd(),
): PublishOptions {
  const expectedFlags = argv.filter((arg) => arg === '--expected-version');
  if (
    expectedFlags.length !== 1 ||
    argv.some((arg) => arg.startsWith('--expected-version='))
  ) {
    throw new Error(
      'Invalid --expected-version: provide the flag exactly once',
    );
  }

  const { values } = (() => {
    try {
      return parseArgs({
        args: argv,
        options: {
          dir: { type: 'string' },
          tag: { type: 'string' },
          registry: { type: 'string' },
          'expected-version': { type: 'string' },
          'dry-run': { type: 'boolean', default: false },
          provenance: { type: 'boolean', default: false },
          'skip-published': { type: 'boolean', default: false },
          'require-existing': { type: 'boolean', default: false },
          'publication-record': { type: 'string' },
          'recovery-records': { type: 'string' },
          'source-commit': { type: 'string' },
        },
        strict: true,
      });
    } catch (error) {
      throw new Error(
        `Invalid --expected-version or publish option: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })();

  const expectedVersion = values['expected-version'];
  if (!expectedVersion || !CANONICAL_SEMVER.test(expectedVersion)) {
    throw new Error('Invalid --expected-version: expected canonical SemVer');
  }
  if (!values.tag) throw new Error('Missing required --tag');
  if (values['recovery-records'] && !values['publication-record'])
    throw new Error('--recovery-records requires --publication-record');
  const attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  const preview = values.tag.match(/^pr-([1-9]\d*)$/);
  const freshVersion =
    !!preview &&
    expectedVersion ===
      `0.0.0-pr.${preview[1]}.${process.env.GITHUB_RUN_NUMBER}.${attempt}`;

  return {
    dir: resolve(cwd, values.dir ?? 'dist/tarballs'),
    tag: values.tag,
    registry: resolveRegistry(values.registry),
    expectedVersion,
    dryRun: values['dry-run'],
    provenance: values.provenance,
    skipPublished: values['skip-published'],
    requireExisting: values['require-existing'],
    recording:
      values['publication-record'] && !values['dry-run']
        ? {
            path: resolve(cwd, values['publication-record']),
            recoveryDirectory: values['recovery-records']
              ? resolve(cwd, values['recovery-records'])
              : undefined,
            context: {
              repository: process.env.GITHUB_REPOSITORY ?? '',
              runId: process.env.GITHUB_RUN_ID ?? '',
              attempt,
              sourceCommit: values['source-commit'] ?? '',
            },
            freshVersion,
          }
        : undefined,
  };
}

function defaultPublish(
  tarball: string,
  _pkg: ValidatedPackedPackage,
  options: PublishOptions,
) {
  const args = [
    'publish',
    tarball,
    '--tag',
    options.tag,
    '--registry',
    options.registry,
    '--access',
    'public',
    '--ignore-scripts',
  ];
  if (options.dryRun) args.push('--dry-run');
  if (options.provenance) args.push('--provenance');
  execFileSync('npm', args, { stdio: ['ignore', 'inherit', 'inherit'] });
}

/**
 * Revalidates every artifact on every invocation before probing or publishing.
 * A positive registry presence may skip one package on a partial rerun, while
 * an indeterminate probe fails closed. Publishing receives the same canonical
 * original paths inspected by the validator; no tarball is repacked or copied.
 * Dry runs never probe for an existing version. Individual publish failures are
 * collected so later validated packages can still be attempted.
 */
export function publishTarballs(
  options: PublishOptions,
  dependencies: PublishDependencies = {},
) {
  let input: unknown;
  try {
    input = JSON.parse(
      readBoundedFile(
        join(options.dir, PACKED_MANIFEST_FILENAME),
        65_536,
      ).toString('utf8'),
    ) as unknown;
  } catch (error) {
    throw new Error(
      `Cannot read ${PACKED_MANIFEST_FILENAME} in ${options.dir}`,
      { cause: error },
    );
  }

  const packages = validatePackedManifest(
    input,
    options.expectedVersion,
    options.dir,
    {
      runArchiveProcess: dependencies.runArchiveProcess,
    },
  );
  const probe = dependencies.isAlreadyPublished ?? isAlreadyPublished;
  const record =
    options.recording && !options.dryRun
      ? createPublicationRecord(options.recording, packages, {
          version: options.expectedVersion,
          registry: options.registry,
          tag: options.tag,
        })
      : undefined;
  if (options.requireExisting && !options.dryRun) {
    const exists = dependencies.hasPublishedPackage ?? hasPublishedPackage;
    for (const pkg of packages) {
      if (!exists(pkg.name, options.registry)) {
        throw new Error(
          `${pkg.name}: complete the first release before publishing previews.`,
        );
      }
    }
  }
  const publish = dependencies.publish ?? defaultPublish;
  const failures: string[] = [];
  let skipped = 0;
  let succeeded = 0;

  const planned: typeof packages = [];
  if (record) {
    const visible = dependencies.hasPublishedIntegrity ?? hasPublishedIntegrity;
    for (const pkg of packages) {
      if (record.accepted(pkg.name)) {
        skipped++;
        continue;
      }
      if (
        visible(
          pkg.name,
          pkg.version,
          options.registry,
          record.integrity(pkg.name),
        )
      ) {
        record.set(pkg.name, 'observed');
        skipped++;
      } else if (record.requiresReconciliation) {
        throw new Error(
          `${pkg.name}: previous publication outcome is unconfirmed. Wait for npm processing or reconcile before starting a new manual recovery run.`,
        );
      } else planned.push(pkg);
    }
  } else planned.push(...packages);

  for (const pkg of planned) {
    if (!record && options.skipPublished && !options.dryRun) {
      if (probe(pkg.name, pkg.version, options.registry)) {
        skipped++;
        continue;
      }
    }
    record?.set(pkg.name, 'in_flight');
    try {
      publish(pkg.tarballPath, pkg, options);
    } catch {
      failures.push(pkg.name);
      continue;
    }
    record?.set(pkg.name, 'accepted');
    succeeded++;
  }

  if (failures.length > 0) {
    throw new Error(`Publish failed for: ${failures.join(', ')}`);
  }
  return { succeeded, skipped };
}

if (import.meta.main) {
  let options: PublishOptions | undefined;
  try {
    options = parsePublishArgs(process.argv.slice(2));
    const result = publishTarballs(options);
    const verb = options.dryRun ? 'Would publish' : 'Published';
    console.log(
      `${verb} ${result.succeeded}, skipped ${result.skipped}, failed 0.`,
    );
  } catch (error) {
    console.error(
      `::error::${error instanceof Error ? error.message : String(error)}`,
    );
    if (options) console.error(authenticationFailureHint(options.registry));
    process.exit(1);
  }
}
