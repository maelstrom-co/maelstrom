import { execFileSync } from 'node:child_process';

export const DEFAULT_REGISTRY = 'https://npm.pkg.github.com';

export function resolveRegistry(explicit?: string): string {
  return explicit ?? process.env.RELEASE_REGISTRY ?? DEFAULT_REGISTRY;
}

function registryHost(registry: string): string | undefined {
  try {
    return new URL(registry).hostname;
  } catch {
    return undefined;
  }
}

export function shouldTreatNotFoundAsUnpublished(
  stderr: string,
  registry: string,
): boolean {
  const notFound = /E404|404 Not Found|code E404/.test(stderr);
  if (registryHost(registry) !== 'npm.pkg.github.com') return notFound;

  // GitHub masks package authorization failures as generic 404s. It only
  // proves absence when it says the package resolved but the version did not.
  return notFound && /404 No match found for version\s/.test(stderr);
}

export function authenticationFailureHint(registry: string): string {
  const host = registryHost(registry);
  if (host === 'npm.pkg.github.com') {
    return (
      'If this was an authentication error, confirm the token has package write ' +
      'access and the package is linked to this repository. See CONTRIBUTING.md.'
    );
  }
  if (host === 'registry.npmjs.org') {
    return 'If this was an authentication error, confirm npm credentials can publish to registry.npmjs.org.';
  }
  return `If this was an authentication error, confirm the configured credentials can publish to ${host ?? 'the configured registry'}.`;
}

// A version already on the registry is immutable, so re-publishing it is a
// hard error rather than a no-op. Treating "already there" as success is what
// makes a re-run after a partial publish able to finish the remaining
// packages instead of dying on the first one that succeeded last time.
//
// Only a genuine "not found" answers the question. Any other failure — DNS,
// a proxy, a bad registry URL — means we do not know, and guessing "not
// published" would turn a network blip into a spurious publish attempt that
// then fails on immutability, which is precisely the resilience
// `--skip-published` exists to provide.
export function isAlreadyPublished(
  name: string,
  version: string,
  registry: string,
): boolean {
  try {
    // execFileSync, never a shell string: `version` derives from a git tag or
    // a workflow_dispatch input, so interpolating it into a command line would
    // let anyone who can push a tag run arbitrary code in the release job —
    // which holds permission to publish packages.
    const output = execFileSync(
      'npm',
      [
        'view',
        `${name}@${version}`,
        'version',
        '--registry',
        registry,
        '--json',
        // One retry, not npm's default three. The default backoff costs ~70s
        // per unreachable lookup, which across every package outruns the job
        // timeout — turning a dead registry into a build that hangs rather
        // than one that reports. A single retry still absorbs a blip.
        '--fetch-retries=1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return parsePublishedVersion(String(output), name, version, registry);
  } catch (err) {
    const stderr = String((err as { stderr?: Buffer | string })?.stderr ?? '');
    if (shouldTreatNotFoundAsUnpublished(stderr, registry)) return false;
    throw new Error(
      `${name}: could not determine whether ${version} is already published on ${registry}. ` +
        `Refusing to guess.\n${stderr.trim()}`,
    );
  }
}

export function parsePublishedVersion(
  output: string,
  name: string,
  version: string,
  registry: string,
): boolean {
  const value = output.trim();
  // GitHub Packages returns a successful response with no body when an exact
  // version is absent. Exit status alone would incorrectly skip the publish.
  if (!value) return false;

  let published: unknown;
  try {
    published = JSON.parse(value);
  } catch {
    throw new Error(
      `${name}: registry returned invalid JSON while checking ${version} on ${registry}.`,
    );
  }

  if (published === version) return true;
  throw new Error(
    `${name}: registry returned ${JSON.stringify(published)} while checking ${version} on ${registry}. Refusing to guess.`,
  );
}
