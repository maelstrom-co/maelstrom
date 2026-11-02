import { expect, test } from 'bun:test';
import { waitForPublishedPackages } from './published-packages.ts';

const options = { version: '0.2.0', registry: 'https://registry.npmjs.org' };

function registryFixture(
  check: (name: string, elapsedMs: number) => boolean,
  lookupMs = 0,
) {
  const clock = {
    elapsedMs: 0,
    sleeps: [] as number[],
    probes: [] as { name: string; timeoutMs: number | undefined }[],
  };
  return {
    clock,
    dependencies: {
      now: () => clock.elapsedMs,
      sleep: (milliseconds: number) => {
        clock.sleeps.push(milliseconds);
        clock.elapsedMs += milliseconds;
      },
      isPublished: (
        name: string,
        _version: string,
        _registry: string,
        timeoutMs?: number,
      ) => {
        clock.probes.push({ name, timeoutMs });
        const visible = check(name, clock.elapsedMs);
        clock.elapsedMs += lookupMs;
        return visible;
      },
      log: () => {},
    },
  };
}

test('allows npm scanning beyond 15 minutes without rechecking available packages', () => {
  const { clock, dependencies } = registryFixture(
    (name, elapsedMs) => name === 'early' || elapsedMs >= 16 * 60_000,
  );
  expect(
    waitForPublishedPackages(['early', 'late'], options, dependencies),
  ).toEqual([]);
  expect(clock.elapsedMs).toBe(16 * 60_000);
  expect(clock.probes.filter((probe) => probe.name === 'early')).toHaveLength(
    1,
  );
  expect(
    clock.probes.filter((probe) => probe.name === 'late').length,
  ).toBeGreaterThan(1);
  expect(clock.probes[0]?.timeoutMs).toBe(30_000);
});

test('shares one deadline across missing packages and includes registry lookup time', () => {
  const { clock, dependencies } = registryFixture(() => false, 200);
  expect(
    waitForPublishedPackages(
      ['first', 'second'],
      { ...options, timeoutMs: 1_000, retryDelayMs: 800 },
      dependencies,
    ),
  ).toEqual(['first', 'second']);
  expect(clock.elapsedMs).toBe(1_000);
  expect(clock.sleeps).toEqual([600]);
  expect(clock.probes).toEqual([
    { name: 'first', timeoutMs: 1_000 },
    { name: 'second', timeoutMs: 800 },
  ]);
});

test('does not start another registry lookup after the release deadline', () => {
  const { clock, dependencies } = registryFixture(() => false, 100);
  const names = Array.from({ length: 23 }, (_, index) => `package-${index}`);
  expect(
    waitForPublishedPackages(
      names,
      { ...options, timeoutMs: 1_000 },
      dependencies,
    ),
  ).toEqual(names);
  expect(clock.probes).toHaveLength(10);
  expect(clock.elapsedMs).toBe(1_000);
  expect(clock.sleeps).toEqual([]);
});

test('stops on an indeterminate registry error instead of waiting or claiming absence', () => {
  const { clock, dependencies } = registryFixture(() => {
    throw new Error('E401 authentication failed');
  });
  expect(() =>
    waitForPublishedPackages(['first', 'second'], options, dependencies),
  ).toThrow('E401 authentication failed');
  expect(clock.probes).toHaveLength(1);
  expect(clock.sleeps).toEqual([]);
});

test('keeps the explicit attempt limit for a one-pass availability check', () => {
  const { clock, dependencies } = registryFixture(() => false);
  expect(
    waitForPublishedPackages(
      ['first', 'second'],
      { ...options, attempts: 1 },
      dependencies,
    ),
  ).toEqual(['first', 'second']);
  expect(clock.probes).toHaveLength(2);
  expect(clock.sleeps).toEqual([]);
});

test.each([
  { timeoutMs: 0 },
  { timeoutMs: -1 },
  { timeoutMs: Number.NaN },
  { timeoutMs: Number.POSITIVE_INFINITY },
  { timeoutMs: 1.5 },
  { retryDelayMs: 0 },
  { retryDelayMs: Number.NaN },
  { attempts: 0 },
  { attempts: Number.POSITIVE_INFINITY },
])('rejects invalid polling limits before registry access: %j', (limits) => {
  const { clock, dependencies } = registryFixture(() => true);
  expect(() =>
    waitForPublishedPackages(
      ['first'],
      { ...options, ...limits },
      dependencies,
    ),
  ).toThrow('must be a positive safe integer');
  expect(clock.probes).toEqual([]);
});
