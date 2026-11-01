import { expect, test } from 'bun:test';
import { join } from 'node:path';

async function probe(scenario: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--conditions=@maelstrom-co/source',
      join(
        import.meta.dir,
        '__fixtures__',
        'planner-provider-lifecycle.test.ts',
      ),
      scenario,
    ],
    {
      cwd: join(import.meta.dir, '..', '..'),
      stdout: 'pipe',
      stderr: 'pipe',
      signal: AbortSignal.timeout(10_000),
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stderr).toBe(0);
  expect(stderr).toBe('');
  expect(stdout.trim()).toBe(scenario);
}

test('cancellation retains paid usage even when TanStack suppresses the terminal chunk', async () => {
  await probe('cancelled-usage');
});

test('provider AbortError ends every planner call as cancelled rather than a retryable provider failure', async () => {
  await probe('provider-abort');
});

test('explicit aborted terminal events retain cancellation and usage without classifying errors by message text', async () => {
  await probe('provider-abort-event');
});

test('failed attempts retain their own usage without adding core retries or contaminating the next request', async () => {
  await probe('distinct-attempts');
});

test('preflight cancellation reports only reached calls without starting provider work or inventing usage', async () => {
  await probe('preflight-cancellation');
});

test('usage observation preserves support for immutable provider adapters', async () => {
  await probe('frozen-adapter');
});

test('planner correction retries retain both attempts without adding the final usage twice', async () => {
  await probe('correction-retry');
});
