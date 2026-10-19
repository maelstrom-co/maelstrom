import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  extractCiMetric,
  readCiMetric,
  readCiMetrics,
  voiceReportNames,
} from './ci-metrics.ts';
import VoiceCiReporter from './ci-reporter.ts';

const response = () => ({
  benchmark: 'playwright-voice',
  mode: 'full-scenario-suite',
  responseLatency: { status: 'measured' },
  summary: { failures: 0, responseLatencyMs: { p95: 1234, sampleCount: 3 } },
  secret: 'never-export-this',
  inputWavBase64: 'never-export-audio',
});
const barge = (greeting = false) => ({
  benchmark: greeting
    ? 'playwright-voice-greeting-barge-in'
    : 'playwright-voice-barge-in',
  status: 'passed',
  validation: {
    status: 'passed',
    failedAttemptCount: 0,
    expectedAttemptCount: 1,
    attemptCount: 1,
  },
  summary: {
    failures: 0,
    bargeIn: {
      counts: { measured: 1, invalid: 0, ambiguous: 0, timeout: 0, failed: 0 },
      latencyMs: { p95: 456, sampleCount: 1 },
    },
  },
});
const sources = () => ({
  'voice-benchmark.json': response(),
  'voice-barge-in-benchmark.json': barge(),
  'voice-greeting-barge-in-benchmark.json': barge(true),
});

test('extracts response latency, not assistant speaking duration, and separates barge-in populations', () => {
  assert.deepEqual(extractCiMetric('voice-benchmark.json', response()), {
    p95Ms: 1234,
    samples: 3,
  });
  assert.deepEqual(extractCiMetric('voice-barge-in-benchmark.json', barge()), {
    p95Ms: 456,
    samples: 1,
  });
  assert.throws(() =>
    extractCiMetric('voice-greeting-barge-in-benchmark.json', barge()),
  );
  for (const value of [NaN, Infinity, -1, null, '456'])
    assert.throws(() => readCiMetric({ p95Ms: value, samples: 1 }));
  assert.throws(() => readCiMetric({ p95Ms: 1, samples: 0 }));
  assert.throws(() => readCiMetric({ p95Ms: 1, samples: 1, raw: 'secret' }));
});

test('invalid, partial and failed measurements cannot become p95 success', () => {
  const invalid = barge();
  invalid.summary.bargeIn.counts.invalid = 1;
  assert.throws(() =>
    extractCiMetric('voice-barge-in-benchmark.json', invalid),
  );
  const missing = barge();
  missing.validation.expectedAttemptCount = 2;
  assert.throws(() =>
    extractCiMetric('voice-barge-in-benchmark.json', missing),
  );
  const partial = response();
  partial.responseLatency.status = 'partial';
  assert.throws(() => extractCiMetric('voice-benchmark.json', partial));
  assert.throws(() => readCiMetrics({ schemaVersion: 1, status: 'failed' }));
});

async function reporterFixture(
  check: (
    reporter: VoiceCiReporter,
    root: string,
    result: () => Promise<unknown>,
    logs: string[],
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'voice-ci-reporter-'));
  await mkdir(join(root, 'results'));
  const logs: string[] = [];
  const reporter = new VoiceCiReporter({ log: (line) => logs.push(line) });
  reporter.onBegin({
    projects: [{ outputDir: join(root, 'results') }],
  } as Parameters<VoiceCiReporter['onBegin']>[0]);
  try {
    await check(
      reporter,
      root,
      async () =>
        JSON.parse(
          await readFile(join(root, 'voice-benchmark-metrics.json'), 'utf8'),
        ),
      logs,
    );
    assert.doesNotMatch(
      logs.join('\n'),
      /never-export|audio-canary|sensitive-canary/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const endTest = (
  reporter: VoiceCiReporter,
  attachments: {
    name: string;
    contentType: string;
    body?: Buffer;
    path?: string;
  }[],
  status = 'passed',
  retry = 0,
) =>
  reporter.onTestEnd(
    {} as Parameters<VoiceCiReporter['onTestEnd']>[0],
    { status, retry, attachments } as Parameters<
      VoiceCiReporter['onTestEnd']
    >[1],
  );
const allAttachments = () =>
  Object.entries(sources()).map(([name, value]) => ({
    name,
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(value)),
  }));

test('reporter emits only bounded scalar metrics, never raw JSON, captions, errors or WAVs', async () => {
  await reporterFixture(async (reporter, _root, result) => {
    await endTest(reporter, [
      ...allAttachments(),
      {
        name: 'session.wav',
        contentType: 'audio/wav',
        body: Buffer.from('audio-canary'),
      },
    ]);
    assert.equal(
      (
        await reporter.onEnd({ status: 'passed' } as Parameters<
          VoiceCiReporter['onEnd']
        >[0])
      ).status,
      'passed',
    );
    const value = readCiMetrics(await result());
    assert.equal(value.assistant.p95Ms, 1234);
    assert.doesNotMatch(JSON.stringify(value), /never-export|audio-canary/);
  });
});

test('duplicates, missing reports, retries and any failed test produce only a failure envelope', async () => {
  for (const variant of ['duplicate', 'missing', 'retry', 'failure'])
    await reporterFixture(async (reporter, _root, result, logs) => {
      const attachments = allAttachments();
      if (variant === 'duplicate' && attachments[0])
        attachments.push(attachments[0]);
      if (variant === 'missing') attachments.pop();
      await endTest(
        reporter,
        attachments,
        variant === 'failure' ? 'failed' : 'passed',
        variant === 'retry' ? 1 : 0,
      );
      assert.equal(
        (
          await reporter.onEnd({ status: 'passed' } as Parameters<
            VoiceCiReporter['onEnd']
          >[0])
        ).status,
        'failed',
      );
      assert.deepEqual(await result(), { schemaVersion: 1, status: 'failed' });
      const category = {
        duplicate: 'attachment-invalid',
        missing: 'metrics-incomplete',
        retry: 'test-retried',
        failure: 'test-failed',
      }[variant];
      assert.ok(logs.some((line) => line.includes(`"category":"${category}"`)));
    });
});

test('file attachments are confined to the output tree and symbolic links are rejected', async () => {
  await reporterFixture(async (reporter, root, result) => {
    const outside = join(root, 'outside.json');
    await writeFile(outside, JSON.stringify(response()));
    const link = join(root, 'results/link.json');
    await symlink(outside, link);
    await endTest(reporter, [
      {
        name: 'voice-benchmark.json',
        contentType: 'application/json',
        path: link,
      },
      ...allAttachments().slice(1),
    ]);
    await reporter.onEnd({ status: 'passed' } as Parameters<
      VoiceCiReporter['onEnd']
    >[0]);
    assert.deepEqual(await result(), { schemaVersion: 1, status: 'failed' });
  });
});

test('attachment names are an exact allowlist', () => {
  assert.deepEqual(Object.keys(voiceReportNames), [
    'voice-benchmark.json',
    'voice-barge-in-benchmark.json',
    'voice-greeting-barge-in-benchmark.json',
  ]);
});

test('reporter failures never emit test titles, raw errors, attachment contents or paths', async () => {
  await reporterFixture(async (reporter, _root, result, logs) => {
    reporter.onError();
    await reporter.onTestEnd(
      { title: 'sensitive-canary' } as Parameters<
        VoiceCiReporter['onTestEnd']
      >[0],
      {
        status: 'failed',
        retry: 0,
        errors: [{ message: 'sensitive-canary' }],
        attachments: [
          {
            name: 'voice-benchmark.json',
            contentType: 'application/json',
            body: Buffer.from('sensitive-canary'),
          },
        ],
      } as Parameters<VoiceCiReporter['onTestEnd']>[1],
    );
    await reporter.onEnd({ status: 'failed' } as Parameters<
      VoiceCiReporter['onEnd']
    >[0]);
    assert.deepEqual(await result(), { schemaVersion: 1, status: 'failed' });
    assert.ok(logs.some((line) => line.includes('"category":"test-failed"')));
    assert.ok(
      logs.some((line) => line.includes('"category":"attachment-invalid"')),
    );
  });
});
