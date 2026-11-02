import { hasPublishedIntegrity, isAlreadyPublished } from './registry.ts';

type VerificationOptions = {
  version: string;
  registry: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  attempts?: number;
  integrities?: ReadonlyMap<string, string>;
};

type VerificationDependencies = {
  isPublished: (
    name: string,
    version: string,
    registry: string,
    timeoutMs: number,
    integrity?: string,
  ) => boolean;
  now: () => number;
  sleep: (milliseconds: number) => void;
  log: (message: string) => void;
};

function positiveInteger(value: number, option: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${option} must be a positive safe integer`);
  }
  return value;
}

/** Waits for registry visibility within one deadline shared by the release. */
export function waitForPublishedPackages(
  names: readonly string[],
  options: VerificationOptions,
  dependencies: VerificationDependencies = {
    isPublished: (name, version, registry, timeoutMs, integrity) =>
      integrity
        ? hasPublishedIntegrity(name, version, registry, integrity, timeoutMs)
        : isAlreadyPublished(name, version, registry, timeoutMs),
    now: () => performance.now(),
    sleep: Bun.sleepSync,
    log: console.log,
  },
): string[] {
  const integrities = options.integrities;
  if (
    integrities &&
    names.some(
      (name) =>
        !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrities.get(name) ?? ''),
    )
  )
    throw new Error('Every package requires a valid tarball checksum');
  const timeoutMs = positiveInteger(
    options.timeoutMs ?? 30 * 60_000,
    '--timeout-ms',
  );
  const retryDelayMs = positiveInteger(
    options.retryDelayMs ?? 30_000,
    '--retry-delay-ms',
  );
  const attempts =
    options.attempts === undefined
      ? Number.POSITIVE_INFINITY
      : positiveInteger(options.attempts, '--attempts');
  const deadline = dependencies.now() + timeoutMs;
  const pending = new Set(names);

  for (let attempt = 1; attempt <= attempts && pending.size > 0; attempt++) {
    for (const name of pending) {
      const remainingMs = Math.ceil(deadline - dependencies.now());
      if (remainingMs <= 0) return [...pending];
      if (
        dependencies.isPublished(
          name,
          options.version,
          options.registry,
          Math.min(30_000, remainingMs),
          options.integrities?.get(name),
        )
      ) {
        pending.delete(name);
        dependencies.log(`✓ ${name}@${options.version} is live`);
      }
    }
    const remainingMs = deadline - dependencies.now();
    if (pending.size === 0 || attempt === attempts || remainingMs <= 0) break;
    dependencies.log(
      `… ${pending.size} package(s) still unavailable after round ${attempt}; waiting for npm processing (${Math.ceil(remainingMs / 60_000)} minute(s) remaining)`,
    );
    dependencies.sleep(Math.min(retryDelayMs, remainingMs));
  }
  return [...pending];
}
