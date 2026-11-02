import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  createMarkdownFileSink,
  writeMarkdownReport,
} from './markdown-report.js';
import {
  createEvaluationPublisher,
  type MarkdownReport,
  prepareMarkdownReportPublication,
} from './publication.js';
import { renderMarkdown, renderPaired, writeReport } from './report.js';
import type { RunRecord } from './run.js';
import type { StageTurnRecord } from './stage-eval.js';
import { renderStageReport, writeStageReport } from './stage-report.js';

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'eval-markdown-'));
  directories.push(path);
  return path;
}
afterEach(async () => {
  mock.restore();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const report = {
  runId: 'run',
  reportId: 'planner',
  markdown: '# Stats\n\n| Pass | 1/2 |\n🌀\n',
};
const options = {
  destinationId: 'local-report',
  artifactId: 'report',
  preparedAt: '2026-10-19T12:34:56Z',
  policy: { maxBytes: 4096, review: () => true },
};

test('prepares a run-only JSON envelope and reviews the exact sealed bytes', () => {
  let reviewed = '';
  const publication = prepareMarkdownReportPublication(report, {
    ...options,
    policy: {
      ...options.policy,
      review: (value) => {
        reviewed = value.json;
        return true;
      },
    },
  });
  expect(publication.json).toBe(reviewed);
  expect(Object.isFrozen(publication)).toBe(true);
  expect(publication.bytes).toBe(Buffer.byteLength(publication.json));
  expect(JSON.parse(publication.json)).toEqual({
    schemaVersion: 3,
    scope: 'run',
    kind: 'markdown-report',
    identity: { runId: 'run', reportId: 'planner' },
    preparedAt: '2026-10-19T12:34:56.000Z',
    mediaType: 'text/markdown',
    markdown: report.markdown,
  });
  expect(prepareMarkdownReportPublication(report, options)).toEqual(
    publication,
  );
  expect(
    prepareMarkdownReportPublication(
      { ...report, reportId: 'stage-select' },
      options,
    ).publicationKey,
  ).not.toBe(publication.publicationKey);
  expect(() =>
    prepareMarkdownReportPublication(report, {
      ...options,
      policy: { ...options.policy, review: () => false },
    }),
  ).toThrow('review rejected');
  expect(() =>
    prepareMarkdownReportPublication(report, {
      ...options,
      policy: { ...options.policy, maxBytes: publication.bytes - 1 },
    }),
  ).toThrow('byte limit');
});

test('rejects malformed identities, time, limits, Markdown and extra fields', () => {
  for (const invalid of [
    { ...report, runId: ' ' },
    { ...report, reportId: '' },
    { ...report, markdown: 2 },
    { ...report, caseId: 'not-a-sample' },
    {
      ...report,
      get markdown() {
        throw new Error('getter must not run');
      },
    },
  ])
    expect(() =>
      prepareMarkdownReportPublication(invalid as MarkdownReport, options),
    ).toThrow();
  expect(() =>
    prepareMarkdownReportPublication(report, {
      ...options,
      preparedAt: '2026-02-30T00:00:00Z',
    }),
  ).toThrow();
  expect(() =>
    prepareMarkdownReportPublication(report, { ...options, destinationId: '' }),
  ).toThrow();
  expect(() =>
    prepareMarkdownReportPublication(report, {
      ...options,
      policy: { ...options.policy, maxBytes: 0 },
    }),
  ).toThrow();
});

test('file sink atomically replaces Markdown through the publisher, and rejects conflicts', async () => {
  const out = await directory();
  const path = join(out, 'report.md');
  await fs.writeFile(path, 'existing report');
  const originalRename = fs.rename;
  const rename = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    expect(dirname(String(from))).toBe(dirname(String(to)));
    expect(from).not.toBe(to);
    expect(to).toBe(path);
    expect(await readFile(path, 'utf8')).toBe('existing report');
    expect(await readFile(from, 'utf8')).toBe(report.markdown);
    await originalRename(from, to);
  });
  const sink = createMarkdownFileSink({
    path,
    destinationId: options.destinationId,
    maxBytes: 4096,
  });
  const publisher = createEvaluationPublisher({
    destinationId: options.destinationId,
    sink,
    timeoutMs: 1000,
    maxEntries: 1,
  });
  const publication = prepareMarkdownReportPublication(report, options);
  expect((await publisher.publish(publication)).status).toBe('accepted');
  expect(await readFile(path, 'utf8')).toBe(report.markdown);
  expect((await publisher.publish(publication)).status).toBe('accepted');
  const conflict = prepareMarkdownReportPublication(
    { ...report, markdown: 'different' },
    options,
  );
  expect((await publisher.publish(conflict)).reason).toBe('conflict');
  expect(await readFile(path, 'utf8')).toBe(report.markdown);
  expect(rename).toHaveBeenCalledTimes(1);
  expect(await readdir(out)).toEqual(['report.md']);
});

test.each([
  { operation: 'write', cleanupFails: false },
  { operation: 'rename', cleanupFails: false },
  { operation: 'write', cleanupFails: true },
  { operation: 'rename', cleanupFails: true },
])(
  'preserves the target and original $operation error when cleanupFails=$cleanupFails',
  async ({ operation, cleanupFails }) => {
    const out = await directory();
    const path = join(out, 'report.md');
    await fs.writeFile(path, 'existing report');
    const failure = new Error(`${operation} failed`);
    const originalWriteFile = fs.writeFile;
    spyOn(fs, 'writeFile').mockImplementation(async (file, data, settings) => {
      await originalWriteFile(
        file,
        operation === 'write' ? 'partial report' : data,
        settings,
      );
      expect(await readFile(path, 'utf8')).toBe('existing report');
      if (operation === 'write') throw failure;
    });
    const rename = spyOn(fs, 'rename').mockRejectedValue(failure);
    const remove = spyOn(fs, 'rm');
    if (cleanupFails) remove.mockRejectedValue(new Error('cleanup failed'));
    const sink = createMarkdownFileSink({
      path,
      destinationId: options.destinationId,
      maxBytes: 4096,
    });
    await expect(
      sink.publish(
        prepareMarkdownReportPublication(report, options),
        new AbortController().signal,
      ),
    ).rejects.toBe(failure);
    expect(await readFile(path, 'utf8')).toBe('existing report');
    expect(rename).toHaveBeenCalledTimes(operation === 'write' ? 0 : 1);
    expect(remove).toHaveBeenCalledTimes(1);
    const remaining = await readdir(out);
    if (cleanupFails) {
      expect(remaining).toHaveLength(2);
      expect(remaining).toContain('report.md');
    } else {
      expect(remaining).toEqual(['report.md']);
    }
  },
);

test.each(['during', 'after'])(
  'aborting %s the temporary write leaves the target intact and removes the temporary file',
  async (timing) => {
    const out = await directory();
    const path = join(out, 'report.md');
    await fs.writeFile(path, 'existing report');
    const controller = new AbortController();
    const failure = new Error('write aborted');
    const originalWriteFile = fs.writeFile;
    spyOn(fs, 'writeFile').mockImplementation(async (file, data, settings) => {
      await originalWriteFile(
        file,
        timing === 'during' ? 'partial report' : data,
        settings,
      );
      controller.abort(failure);
      if (timing === 'during') controller.signal.throwIfAborted();
    });
    const rename = spyOn(fs, 'rename');
    const sink = createMarkdownFileSink({
      path,
      destinationId: options.destinationId,
      maxBytes: 4096,
    });
    await expect(
      sink.publish(
        prepareMarkdownReportPublication(report, options),
        controller.signal,
      ),
    ).rejects.toBe(failure);
    expect(rename).not.toHaveBeenCalled();
    expect(await readFile(path, 'utf8')).toBe('existing report');
    expect(await readdir(out)).toEqual(['report.md']);
  },
);

test('sink rejects unsupported, tampered, oversized, misdirected and aborted publications before writing', async () => {
  const path = join(await directory(), 'report.md');
  const publication = prepareMarkdownReportPublication(report, options);
  const sink = createMarkdownFileSink({
    path,
    destinationId: options.destinationId,
    maxBytes: 4096,
  });
  for (const invalid of [
    {
      ...publication,
      json: publication.json.replace('"schemaVersion":3', '"schemaVersion":1'),
    },
    { ...publication, json: 'x'.repeat(4097) },
    { ...publication, json: '{}' },
    {
      ...publication,
      json: publication.json.replace('text/markdown', 'text/plain'),
    },
    { ...publication, bytes: 1 },
    { ...publication, payloadDigest: 'fake' },
    { ...publication, publicationKey: 'fake' },
    { ...publication, publicationId: 'fake' },
    { ...publication, destinationId: 'elsewhere' },
  ])
    expect(await sink.publish(invalid, new AbortController().signal)).toEqual({
      status: 'failed',
    });
  expect(await sink.publish(publication, AbortSignal.abort())).toEqual({
    status: 'failed',
  });
  await expect(readFile(path)).rejects.toThrow();
});

test('local write failures reject rather than reporting successful delivery', async () => {
  await expect(
    writeMarkdownReport(
      join(await directory(), 'missing', 'report.md'),
      report,
    ),
  ).rejects.toThrow('Markdown report publication uncertain');
});

test('planner writer preserves summary and paired renderer bytes and stats', async () => {
  const out = await directory();
  const records: RunRecord[] = [
    {
      scenarioId: 'synthetic',
      suite: 'development',
      arm: 'baseline',
      kind: 'baseline',
      repeat: 1,
      turnMs: 100,
      expectedDeferral: false,
      arrangementRules: false,
      score: { pass: true, failures: [] },
    },
  ];
  const summaries = await writeReport(
    out,
    records,
    {},
    { plugins: [] },
    'completed-run',
  );
  expect(await readFile(join(out, 'report.md'), 'utf8')).toBe(
    renderMarkdown(summaries, {}, { plugins: [] }),
  );
  expect(await readFile(join(out, 'paired.md'), 'utf8')).toBe(
    renderPaired(records),
  );
  expect(await readFile(join(out, 'report.md'), 'utf8')).toContain(
    '1/1 (100.0%)',
  );
});

test.each([
  'select',
  'actions',
  'layout',
  'decisions-select',
  'decisions-actions',
  'decisions-layout',
])('%s writer preserves stage renderer bytes and stats', async (stage) => {
  const out = await directory();
  const records: StageTurnRecord[] = [
    {
      stage,
      scenarioId: 'synthetic',
      suite: 'development',
      variant: 'variant',
      repeat: 1,
      outcome: 'pass',
      calls: [],
      failures: [],
      judge: { schemaVersion: 1, status: 'not_run', reason: 'disabled' },
    },
  ];
  const subject = { stage };
  await writeStageReport(
    out,
    subject,
    records,
    ['variant'],
    {},
    ['## Extra stats'],
    'completed-run',
  );
  const markdown = await readFile(join(out, 'report.md'), 'utf8');
  expect(markdown).toBe(
    `${renderStageReport(subject, records, ['variant'], {}, ['## Extra stats'])}\n`,
  );
  expect(markdown).toContain('1/1 (100%)');
  expect(markdown).toContain('## Extra stats');
});
