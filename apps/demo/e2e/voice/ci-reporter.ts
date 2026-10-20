import { rmSync } from 'node:fs';
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
  readCiProvenance,
  type VoiceCiLane,
  type VoiceCiProvenance,
  VoiceMetricRejection,
  type VoiceRejectionReason,
  type VoiceReportName,
  voiceReportNames,
} from './ci-metrics.ts';

type Lane = { outcome: VoiceCiLane; poisoned: boolean };
export default class VoiceCiReporter implements Reporter {
  private outputRoot = '';
  private failed = false;
  private readonly pending = new Set<Promise<void>>();
  private provenance?: VoiceCiProvenance;
  private readonly lanes = new Map<VoiceReportName, Lane>();
  private readonly tests = new Map<
    string,
    { reason?: VoiceRejectionReason; reports: Set<VoiceReportName> }
  >();
  constructor(
    private readonly options: {
      log?: (line: string) => void;
      environment?: NodeJS.ProcessEnv;
    } = {},
  ) {}

  private diagnostic(
    phase: VoiceDiagnostic['phase'],
    category: VoiceDiagnostic['category'],
  ) {
    logVoiceDiagnostic({ phase, category }, this.options.log);
  }
  private reject(name: VoiceReportName, reason: VoiceRejectionReason) {
    this.failed = true;
    const lane = this.lanes.get(name);
    if (!lane) return;
    if (
      lane.outcome.status !== 'unavailable' ||
      lane.outcome.reason !== 'duplicate-report'
    )
      lane.outcome = { status: 'unavailable', reason };
    lane.poisoned = true;
    logVoiceDiagnostic(
      {
        phase: 'attachments',
        category: 'attachment-invalid',
        report: name,
        reason,
      },
      this.options.log,
    );
  }

  onBegin(config: FullConfig) {
    this.diagnostic('tests', 'started');
    if (config.projects.length !== 1 || !config.projects[0])
      throw new Error('CI benchmarks require one project');
    this.outputRoot = config.projects[0].outputDir;
    rmSync(resolve(this.outputRoot, '..', 'voice-benchmark-metrics.json'), {
      force: true,
    });
    const environment = this.options.environment ?? process.env;
    this.provenance = readCiProvenance({
      targetSha: environment.VOICE_BENCHMARK_TARGET_SHA,
      runId: environment.VOICE_BENCHMARK_RUN_ID,
      runAttempt: environment.VOICE_BENCHMARK_RUN_ATTEMPT,
    });
  }
  onError() {
    this.diagnostic('tests', 'test-failed');
    this.failed = true;
  }

  onTestEnd(test: TestCase, result: TestResult): Promise<void> {
    // Playwright does not await onTestEnd; onEnd must drain file reads before publishing.
    const work = this.collectTestResult(test, result).catch(() => {
      this.failed = true;
      this.diagnostic('attachments', 'unexpected-error');
    });
    this.pending.add(work);
    void work.then(() => this.pending.delete(work));
    return work;
  }

  private async collectTestResult(test: TestCase, result: TestResult) {
    const owner = this.tests.get(test.id) ?? {
      reports: new Set<VoiceReportName>(),
    };
    this.tests.set(test.id, owner);
    if (result.status !== 'passed') {
      this.diagnostic('tests', 'test-failed');
      this.failed = true;
      owner.reason = 'test-failed';
    }
    if (result.retry !== 0) {
      this.diagnostic('tests', 'test-retried');
      this.failed = true;
      owner.reason = 'test-retried';
    }
    if (owner.reason)
      for (const name of owner.reports) this.reject(name, owner.reason);
    for (const attachment of result.attachments) {
      if (!Object.hasOwn(voiceReportNames, attachment.name)) continue;
      const name = attachment.name as VoiceReportName;
      owner.reports.add(name);
      if (this.lanes.has(name)) {
        this.reject(name, 'duplicate-report');
        continue;
      }
      const lane: Lane = {
        outcome: { status: 'unavailable', reason: 'missing-report' },
        poisoned: false,
      };
      this.lanes.set(name, lane);
      try {
        if (owner.reason) throw new VoiceMetricRejection(owner.reason);
        if (attachment.contentType !== 'application/json')
          throw new VoiceMetricRejection('invalid-content-type');
        let body = attachment.body;
        if (!body && attachment.path) {
          try {
            const root = await realpath(this.outputRoot);
            const path = await realpath(attachment.path);
            const stat = await lstat(attachment.path);
            if (
              !path.startsWith(`${root}${sep}`) ||
              !stat.isFile() ||
              stat.isSymbolicLink()
            )
              throw new VoiceMetricRejection('unsafe-attachment');
            if (stat.size > 2_000_000)
              throw new VoiceMetricRejection('attachment-too-large');
            body = await readFile(path);
          } catch (error) {
            throw error instanceof VoiceMetricRejection
              ? error
              : new VoiceMetricRejection('attachment-missing');
          }
        }
        if (!body) throw new VoiceMetricRejection('attachment-missing');
        if (body.byteLength > 2_000_000)
          throw new VoiceMetricRejection('attachment-too-large');
        let value: unknown;
        try {
          value = JSON.parse(body.toString('utf8'));
        } catch {
          throw new VoiceMetricRejection('invalid-json');
        }
        const metric = extractCiMetric(name, value);
        if (!lane.poisoned) lane.outcome = { status: 'validated', ...metric };
      } catch (error) {
        this.reject(
          name,
          error instanceof VoiceMetricRejection
            ? error.reason
            : 'invalid-report',
        );
      }
    }
  }

  async onEnd(result: FullResult) {
    await Promise.all(this.pending);
    if (!this.provenance) throw new Error('CI metrics provenance unavailable');
    if (result.status !== 'passed') this.diagnostic('tests', 'test-failed');
    for (const name of Object.keys(voiceReportNames) as VoiceReportName[]) {
      if (!this.lanes.has(name)) {
        this.lanes.set(name, {
          outcome: { status: 'unavailable', reason: 'missing-report' },
          poisoned: true,
        });
        this.reject(name, 'missing-report');
      }
    }
    const complete = [...this.lanes.values()].every(
      (lane) => lane.outcome.status === 'validated',
    );
    if (!complete) this.diagnostic('metrics', 'metrics-incomplete');
    const passed = !this.failed && result.status === 'passed' && complete;
    const output = {
      schemaVersion: 2,
      status: passed ? 'passed' : 'failed',
      provenance: this.provenance,
      ...Object.fromEntries(
        Object.entries(voiceReportNames).map(([name, key]) => [
          key,
          this.lanes.get(name as VoiceReportName)?.outcome,
        ]),
      ),
    };
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
