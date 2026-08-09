import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type ArchiveProcessRequest,
  type ArchiveProcessResult,
  PACKED_MANIFEST_FILENAME,
  type ValidatedPackedPackage,
  validatePackedManifest,
} from './lib/packed-manifest.ts';
import {
  authenticationFailureHint,
  isAlreadyPublished,
  resolveRegistry,
} from './lib/registry.ts';

// The publishing half of the release. It runs in the only job that holds a
// GitHub Packages identity, and it deliberately does nothing that could execute
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
};

type PublishDependencies = {
  runArchiveProcess?: (request: ArchiveProcessRequest) => ArchiveProcessResult;
  isAlreadyPublished?: typeof isAlreadyPublished;
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

  return {
    dir: resolve(cwd, values.dir ?? 'dist/tarballs'),
    tag: values.tag,
    registry: resolveRegistry(values.registry),
    expectedVersion,
    dryRun: values['dry-run'],
    provenance: values.provenance,
    skipPublished: values['skip-published'],
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
      readFileSync(join(options.dir, PACKED_MANIFEST_FILENAME), 'utf8'),
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
  const publish = dependencies.publish ?? defaultPublish;
  const failures: string[] = [];
  let skipped = 0;
  let succeeded = 0;

  for (const pkg of packages) {
    if (options.skipPublished && !options.dryRun) {
      if (probe(pkg.name, pkg.version, options.registry)) {
        skipped++;
        continue;
      }
    }
    try {
      publish(pkg.tarballPath, pkg, options);
      succeeded++;
    } catch {
      failures.push(pkg.name);
    }
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
