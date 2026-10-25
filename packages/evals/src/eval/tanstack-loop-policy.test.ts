import { expect, test } from 'bun:test';
import { join } from 'node:path';

async function probe(scenario: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--conditions=@maelstrom-co/source',
      join(import.meta.dir, '__fixtures__', 'tanstack-loop-policy.ts'),
      scenario,
    ],
    {
      cwd: join(import.meta.dir, '..', '..'),
      stdout: 'pipe',
      stderr: 'pipe',
      signal: AbortSignal.timeout(10_000),
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  expect(stderr).toBe('');
  expect(stdout.trim()).toBe(scenario);
}

test('authorization precedes a cache hit so another principal cannot receive the cached result', async () => {
  await probe('cache-authorization');
});

test('a real cache hit bypasses guard-only authorization, so that composition is not safe to adopt', async () => {
  await probe('cache-bypasses-guard');
});

test('scoped cache keys and expiry prevent stale or cross-principal reads while mutations always execute', async () => {
  await probe('cache-scope-and-freshness');
});

test('transformed arguments reach the guard but substituted results need validation outside executor output schemas', async () => {
  await probe('substituted-result-validation');
});

test('the usage wrapper counts both model turns while onFinish reports only the last turn', async () => {
  await probe('multi-turn-usage');
});

test('structured finalization remains a third billable call instead of disappearing into final-turn usage', async () => {
  await probe('finalization-usage');
});

test('a failed model turn retains its reported usage after earlier tool work', async () => {
  await probe('failed-turn-usage');
});

test('concurrent callers keep roles and missing usage separate from explicitly reported zero', async () => {
  await probe('concurrent-usage-presence');
});

test('initial admission middleware rejects zero model budget before either the adapter or a tool runs', async () => {
  await probe('initial-admission');
});

test('batch reservations cap side effects and sequential execution preserves dependent mutation results', async () => {
  await probe('batch-reservations');
});

test('a usage guard blocks already-emitted tools when observed tokens exhaust the budget or usage is unknown', async () => {
  await probe('usage-before-tools');
});

test('cancellation prevents another model turn but cannot undo a non-cooperative tool side effect', async () => {
  await probe('non-cooperative-cancellation');
});

test('rate-limit retries consume separate provider calls even within one model turn', async () => {
  await probe('retry-usage');
});

test('a monotonic deadline guard prevents side effects when the model returns at or after the deadline', async () => {
  await probe('deadline-before-tools');
});

test('the token guard sums earlier turns instead of admitting another mutation from the latest usage alone', async () => {
  await probe('cumulative-token-budget');
});
