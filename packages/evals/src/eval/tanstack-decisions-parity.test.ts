import { expect, test } from 'bun:test';
import { join } from 'node:path';

async function probe(scenario: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--conditions=@maelstrom-co/source',
      join(import.meta.dir, '__fixtures__', 'tanstack-decisions-parity.ts'),
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

test('duplicate provider answers collapse to the last value, so normalized results cannot establish uniqueness', async () => {
  await probe('duplicate-answers');
});

test('duplicate probability entries collapse before downstream validation can detect them', async () => {
  await probe('duplicate-probabilities');
});

test('public decision mapping accepts invalid probabilities, so it cannot replace strict transport validation', async () => {
  await probe('invalid-probabilities');
});

test('the public score path changes request labels and rounds the score instead of selecting the most probable level', async () => {
  await probe('score-encoding');
});

test('refusal metadata keeps usage and partial answers but exposes the refused question only in error text', async () => {
  await probe('refusal-identity');
});

test('the public result tolerates a missing model echo but discards raw reply evidence', async () => {
  await probe('model-and-raw-reply');
});

test('SDK retries must be disabled explicitly and HTTP errors still expose provider text', async () => {
  await probe('http-failure-and-retry');
});

test('the public adapter consumes a reply larger than the existing transport limit', async () => {
  await probe('bounded-body-reads');
});

test('SDK timeout and user cancellation remain distinct errors that need application mapping', async () => {
  await probe('timeout-and-abort');
});
