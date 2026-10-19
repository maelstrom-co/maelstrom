import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { logVoiceDiagnostic, type VoiceDiagnostic } from './ci-diagnostics.ts';
import {
  extractCiMetric,
  type VoiceCiMetric,
  voiceReportNames,
} from './ci-metrics.ts';

export default class VoiceCiReporter implements Reporter {
  private outputRoot = '';
  private failed = false;
  private readonly metrics = new Map<string, VoiceCiMetric>();

  private readonly log: ((line: string) => void) | undefined;

  constructor(options: { log?: (line: string) => void } = {}) {
    this.log = options.log;
  }

  private diagnostic(
    phase: VoiceDiagnostic['phase'],
    category: VoiceDiagnostic['category'],
  ) {
    logVoiceDiagnostic({ phase, category }, this.log);
  }

  onBegin(config: FullConfig) {
    this.diagnostic('tests', 'started');
    if (config.projects.length !== 1 || !config.projects[0]) {
      this.diagnostic('tests', 'unexpected-error');
      throw new Error('CI benchmarks require one project');
    }
    this.outputRoot = config.projects[0].outputDir;
  }

  onError() {
    this.diagnostic('tests', 'test-failed');
    this.failed = true;
  }

  async onTestEnd(_test: TestCase, result: TestResult) {
    if (result.status !== 'passed') {
      this.diagnostic('tests', 'test-failed');
      this.failed = true;
    }
    if (result.retry !== 0) {
      this.diagnostic('tests', 'test-retried');
      this.failed = true;
    }
    for (const attachment of result.attachments) {
      if (!Object.hasOwn(voiceReportNames, attachment.name)) continue;
      try {
        const name = attachment.name as keyof typeof voiceReportNames;
        if (
          this.metrics.has(name) ||
          attachment.contentType !== 'application/json' ||
          result.status !== 'passed'
        )
          throw new Error('Duplicate or invalid benchmark attachment');
        let body = attachment.body;
        if (!body && attachment.path) {
          const root = await realpath(this.outputRoot);
          const path = await realpath(attachment.path);
          const stat = await lstat(attachment.path);
          if (
            !path.startsWith(`${root}${sep}`) ||
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.size > 2_000_000
          )
            throw new Error('Unsafe benchmark attachment');
          body = await readFile(path);
        }
        if (!body || body.byteLength > 2_000_000)
          throw new Error('Missing benchmark attachment');
        this.metrics.set(
          name,
          extractCiMetric(name, JSON.parse(body.toString('utf8'))),
        );
      } catch {
        this.diagnostic('attachments', 'attachment-invalid');
        this.failed = true;
      }
    }
  }

  async onEnd(result: FullResult) {
    if (result.status !== 'passed') this.diagnostic('tests', 'test-failed');
    if (this.metrics.size !== 3)
      this.diagnostic('metrics', 'metrics-incomplete');
    const passed =
      !this.failed && result.status === 'passed' && this.metrics.size === 3;
    const output: Record<string, unknown> = {
      schemaVersion: 1,
      status: passed ? 'passed' : 'failed',
    };
    if (passed)
      for (const [name, key] of Object.entries(voiceReportNames))
        output[key] = this.metrics.get(name);
    try {
      await writeFile(
        resolve(this.outputRoot, '..', 'voice-benchmark-metrics.json'),
        JSON.stringify(output),
        { mode: 0o600 },
      );
    } catch (error) {
      this.diagnostic('metrics', 'unexpected-error');
      throw error;
    }
    if (passed) this.diagnostic('tests', 'completed');
    return { status: passed ? ('passed' as const) : ('failed' as const) };
  }
}
