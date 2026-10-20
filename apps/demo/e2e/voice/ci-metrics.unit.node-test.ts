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
  VoiceMetricRejection,
  type VoiceReportName,
  voiceReportNames,
} from './ci-metrics.ts';
import VoiceCiReporter from './ci-reporter.ts';

const provenance = {
  targetSha: 'a'.repeat(40),
  runId: '123456789',
  runAttempt: '1',
};
const response = () => ({
  benchmark: 'playwright-voice',
  mode: 'full-scenario-suite',
  responseLatency: {
    status: 'measured',
    turns: [
      { status: 'measured', latencyMs: 1234 },
      { status: 'measured', latencyMs: 1234 },
      { status: 'measured', latencyMs: 1234 },
    ],
  },
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
  attempts: [{ measurement: { status: 'measured', latencyMs: 456 } }],
  summary: {
    failures: 0,
    bargeIn: {
      attemptCount: 1,
      validAttemptCount: 1,
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
const reportNames = Object.keys(voiceReportNames) as VoiceReportName[];
const read = (value: unknown) => readCiMetrics(value, provenance);

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
  const reporter = new VoiceCiReporter({
    log: (line) => logs.push(line),
    environment: {
      VOICE_BENCHMARK_TARGET_SHA: provenance.targetSha,
      VOICE_BENCHMARK_RUN_ID: provenance.runId,
      VOICE_BENCHMARK_RUN_ATTEMPT: provenance.runAttempt,
    },
  });
  // Reporter initialization must not preserve even a same-attempt stale output.
  await writeFile(join(root, 'voice-benchmark-metrics.json'), 'stale');
  await reporter.onBegin({
    projects: [{ outputDir: join(root, 'results') }],
  } as Parameters<VoiceCiReporter['onBegin']>[0]);
  await assert.rejects(readFile(join(root, 'voice-benchmark-metrics.json')));
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
let testId = 0;
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
  id = String(++testId),
) =>
  reporter.onTestEnd(
    { id } as Parameters<VoiceCiReporter['onTestEnd']>[0],
    { status, retry, attachments } as Parameters<
      VoiceCiReporter['onTestEnd']
    >[1],
  );
const end = (reporter: VoiceCiReporter, status = 'passed') =>
  reporter.onEnd({ status } as Parameters<VoiceCiReporter['onEnd']>[0]);
const allAttachments = () =>
  Object.entries(sources()).map(([name, value]) => ({
    name,
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(value)),
  }));

test('extracts only fully measured populations without accepting invalid attempts, counts or scalar values', () => {
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
  for (const mutate of [
    (report: ReturnType<typeof barge>) => {
      report.status = 'failed';
    },
    (report: ReturnType<typeof barge>) => {
      report.summary.failures = 1;
    },
    (report: ReturnType<typeof barge>) => {
      report.summary.bargeIn.counts.invalid = 1;
    },
    (report: ReturnType<typeof barge>) => {
      report.validation.expectedAttemptCount = 2;
    },
    (report: ReturnType<typeof barge>) => {
      report.summary.bargeIn.validAttemptCount = 2;
    },
    (report: ReturnType<typeof barge>) => {
      report.attempts = [];
    },
    (report: ReturnType<typeof barge>) => {
      const first = report.attempts[0];
      assert.ok(first);
      first.measurement.status = 'invalid';
    },
  ]) {
    const report = barge();
    mutate(report);
    assert.throws(
      () => extractCiMetric('voice-barge-in-benchmark.json', report),
      VoiceMetricRejection,
    );
  }
  const partial = response();
  partial.responseLatency.status = 'partial';
  assert.throws(() => extractCiMetric('voice-benchmark.json', partial));
  const counts = response();
  counts.responseLatency.turns.pop();
  assert.throws(() => extractCiMetric('voice-benchmark.json', counts));
});

test('all valid reports pass and export only versioned numeric lanes and current provenance', async () => {
  await reporterFixture(async (reporter, _root, result) => {
    await endTest(reporter, [
      ...allAttachments(),
      {
        name: 'session.wav',
        contentType: 'audio/wav',
        body: Buffer.from('audio-canary'),
      },
    ]);
    assert.equal((await end(reporter)).status, 'passed');
    const value = read(await result());
    assert.equal(value.status, 'passed');
    assert.deepEqual(value.provenance, provenance);
    assert.deepEqual(value.assistant, {
      status: 'validated',
      p95Ms: 1234,
      samples: 3,
    });
    assert.doesNotMatch(JSON.stringify(value), /never-export|audio-canary/);
  });
});

for (const name of reportNames) {
  for (const reason of ['invalid', 'missing'] as const)
    test(`${name} ${reason} keeps valid sibling metrics but the job failed`, async () => {
      await reporterFixture(async (reporter, _root, result, logs) => {
        const attachments = allAttachments().filter(
          (attachment) => attachment.name !== name,
        );
        if (reason === 'invalid')
          attachments.push({
            name,
            contentType: 'application/json',
            body: Buffer.from(
              JSON.stringify({ ...sources()[name], summary: { failures: 1 } }),
            ),
          });
        await endTest(reporter, attachments);
        assert.equal((await end(reporter)).status, 'failed');
        const value = read(await result());
        assert.equal(value.status, 'failed');
        for (const reportName of reportNames)
          assert.equal(
            value[voiceReportNames[reportName]].status,
            reportName === name ? 'unavailable' : 'validated',
          );
        assert.deepEqual(value[voiceReportNames[name]], {
          status: 'unavailable',
          reason: reason === 'missing' ? 'missing-report' : 'benchmark-failed',
        });
        assert.ok(
          logs.some(
            (line) =>
              line.includes(`"report":"${name}"`) &&
              line.includes(
                `"reason":"${reason === 'missing' ? 'missing-report' : 'benchmark-failed'}"`,
              ),
          ),
        );
      });
    });
}

test('duplicates permanently poison a lane before or after accepted or rejected data', async () => {
  for (const invalidFirst of [false, true])
    await reporterFixture(async (reporter, _root, result) => {
      const attachments = allAttachments();
      const duplicate = attachments[0];
      assert.ok(duplicate);
      await endTest(
        reporter,
        invalidFirst
          ? [{ ...duplicate, body: Buffer.from('not JSON') }]
          : [duplicate],
      );
      await endTest(reporter, attachments);
      await endTest(reporter, [duplicate]);
      assert.equal((await end(reporter)).status, 'failed');
      const value = read(await result());
      assert.deepEqual(value.assistant, {
        status: 'unavailable',
        reason: 'duplicate-report',
      });
      assert.equal(value.taskBargeIn.status, 'validated');
    });
});

test('asynchronous file loading cannot overwrite a concurrent duplicate rejection', async () => {
  await reporterFixture(async (reporter, root, result) => {
    const path = join(root, 'results/report.json');
    await writeFile(path, JSON.stringify(response()));
    const pending = endTest(reporter, [
      { name: 'voice-benchmark.json', contentType: 'application/json', path },
    ]);
    await endTest(reporter, allAttachments());
    await pending;
    await end(reporter);
    assert.deepEqual(read(await result()).assistant, {
      status: 'unavailable',
      reason: 'duplicate-report',
    });
  });
});

test('onEnd drains asynchronous file attachments even when Playwright does not await onTestEnd', async () => {
  await reporterFixture(async (reporter, root, result) => {
    const attachments = [];
    for (const [name, report] of Object.entries(sources())) {
      const path = join(root, 'results', name);
      await writeFile(path, JSON.stringify(report));
      attachments.push({ name, contentType: 'application/json', path });
    }
    void endTest(reporter, attachments);
    assert.equal((await end(reporter)).status, 'passed');
    assert.equal(read(await result()).status, 'passed');
  });
});

test('failed or retried associated tests invalidate their lanes while unrelated test failures retain validated lanes', async () => {
  for (const scenario of [
    'failed',
    'retry',
    'later-retry',
    'unrelated',
    'full-result',
  ] as const)
    await reporterFixture(async (reporter, _root, result) => {
      await endTest(reporter, allAttachments().slice(1));
      await endTest(
        reporter,
        allAttachments().slice(0, 1),
        scenario === 'failed' ? 'failed' : 'passed',
        scenario === 'retry' ? 1 : 0,
        'owner',
      );
      if (scenario === 'later-retry')
        await endTest(reporter, [], 'passed', 1, 'owner');
      if (scenario === 'unrelated') await endTest(reporter, [], 'failed');
      assert.equal(
        (await end(reporter, scenario === 'full-result' ? 'failed' : 'passed'))
          .status,
        'failed',
      );
      const value = read(await result());
      assert.equal(value.status, 'failed');
      assert.equal(value.taskBargeIn.status, 'validated');
      assert.equal(
        value.assistant.status,
        ['unrelated', 'full-result'].includes(scenario)
          ? 'validated'
          : 'unavailable',
      );
    });
});

test('all invalid reports and infrastructure errors emit failed outcomes without numeric lanes', async () => {
  await reporterFixture(async (reporter, _root, result, logs) => {
    reporter.onError();
    await endTest(
      reporter,
      allAttachments().map((attachment) => ({
        ...attachment,
        body: Buffer.from('sensitive-canary'),
      })),
    );
    assert.equal((await end(reporter, 'failed')).status, 'failed');
    const value = read(await result());
    for (const name of reportNames)
      assert.deepEqual(value[voiceReportNames[name]], {
        status: 'unavailable',
        reason: 'invalid-json',
      });
    assert.equal(
      logs.filter((line) => line.includes('"reason":"invalid-json"')).length,
      3,
    );
  });
});

test('unsafe, missing and oversized attachments use only bounded reasons; valid files remain accepted', async () => {
  for (const variant of [
    'valid',
    'symlink',
    'outside',
    'missing',
    'large',
    'content-type',
  ] as const)
    await reporterFixture(async (reporter, root, result) => {
      const outside = join(root, 'outside-sensitive-canary.json');
      await writeFile(outside, JSON.stringify(response()));
      const path = join(root, 'results/report.json');
      if (variant === 'symlink') await symlink(outside, path);
      else if (variant !== 'missing')
        await writeFile(
          path,
          variant === 'large'
            ? 'x'.repeat(2_000_001)
            : JSON.stringify(response()),
        );
      await endTest(reporter, [
        {
          name: 'voice-benchmark.json',
          contentType:
            variant === 'content-type' ? 'text/plain' : 'application/json',
          path: variant === 'outside' ? outside : path,
        },
        ...allAttachments().slice(1),
      ]);
      await end(reporter);
      assert.equal(
        read(await result()).assistant.status,
        variant === 'valid' ? 'validated' : 'unavailable',
      );
    });
});

test('partial envelopes require exact provenance and closed per-lane shapes', async () => {
  await reporterFixture(async (reporter, _root, result) => {
    await endTest(reporter, allAttachments().slice(0, 2));
    await end(reporter);
    const value = read(await result());
    for (const change of [
      { targetSha: 'b'.repeat(40) },
      { runId: '999' },
      { runAttempt: '2' },
    ])
      assert.throws(
        () => readCiMetrics(value, { ...provenance, ...change }),
        /provenance mismatch/,
      );
    for (const change of [
      { schemaVersion: 1 },
      { status: 'passed' },
      { provenance: { ...provenance, secret: 'no' } },
      { greetingBargeIn: { status: 'unavailable', reason: 'secret-canary' } },
      {
        greetingBargeIn: {
          status: 'unavailable',
          reason: 'missing-report',
          p95Ms: 1,
        },
      },
      { assistant: { status: 'validated', p95Ms: NaN, samples: 1 } },
    ])
      assert.throws(() => read({ ...value, ...change }));
  });
});

test('attachment names remain an exact allowlist', () =>
  assert.deepEqual(reportNames, [
    'voice-benchmark.json',
    'voice-barge-in-benchmark.json',
    'voice-greeting-barge-in-benchmark.json',
  ]));
