import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createEvaluationPublisher,
  type EvaluationPublication,
  type EvaluationPublicationMetadata,
  type PublicationOutcome,
  type PublicationStatus,
  prepareEvaluationPublication,
  prepareRunTelemetryPublication,
  type RunTelemetryResult,
} from '../../packages/evals/src/core/publication.ts';
import type { EvaluationResult } from '../../packages/evals/src/core/runtime/evaluate.js';
import { importFullPlannerRun } from './full-planner-run.ts';
import { mapLangfuseV3Publication } from './mapping.ts';
import type { LangfuseV3Config, LangfuseV3Sink } from './sink.js';

const maxInputBytes = 8 * 1024 * 1024;
const flagOptions = {
  input: { type: 'string' },
  'input-format': { type: 'string', default: 'result' },
  destination: { type: 'string' },
  artifact: { type: 'string' },
  'prepared-at': { type: 'string' },
  'base-url': { type: 'string' },
  'server-version': { type: 'string' },
  'preview-out': { type: 'string' },
  publish: { type: 'boolean', default: false },
  'approve-sha256': { type: 'string' },
  'max-input-bytes': { type: 'string', default: String(maxInputBytes) },
  'max-publications': { type: 'string', default: '1000' },
  'max-preview-bytes': { type: 'string', default: '8388608' },
  'max-publication-bytes': { type: 'string', default: '16384' },
  'max-batch-bytes': { type: 'string', default: '65536' },
  'timeout-ms': { type: 'string', default: '10000' },
  'shutdown-timeout-ms': { type: 'string', default: '5000' },
  'max-in-flight': { type: 'string', default: '1' },
  help: { type: 'boolean' },
} as const;

type Dependencies = {
  readonly nodeVersion?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly startSink?: (
    config: LangfuseV3Config,
  ) => LangfuseV3Sink | Promise<LangfuseV3Sink>;
};

/** Sanitized CLI result; no payload, path, endpoint, identity text or raw error is logged. */
export interface LangfuseCliOutcome {
  /** Zero is preview success or accepted delivery with clean shutdown; see README for others. */
  readonly exitCode: 0 | 1 | 2 | 3;
  /** JSON-safe status codes and content hashes only. */
  readonly output: Readonly<
    Record<string, string | number | readonly PublicationOutcome[]>
  >;
}

/** Standalone CLI implementation, not an embedding API; credentials and SDK startup are publish-only. */
export async function runLangfuseCli(
  argv: readonly string[],
  dependencies: Dependencies = {},
): Promise<LangfuseCliOutcome> {
  let code = 'unsupported_runtime';
  try {
    const nodeVersion =
      dependencies.nodeVersion ??
      (process.versions.bun ? '0' : process.versions.node);
    if (
      !/^\d+\.\d+\.\d+$/.test(nodeVersion) ||
      Number(nodeVersion.split('.')[0]) < 24
    )
      throw new Error();
    code = 'invalid_arguments';
    const { values, tokens } = parseArgs({
      args: [...argv],
      options: flagOptions,
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
    const names = tokens.flatMap((token) =>
      token.kind === 'option' ? [token.name] : [],
    );
    if (new Set(names).size !== names.length) throw new Error();
    if (values.help) {
      if (argv.length !== 1) throw new Error();
      return {
        exitCode: 0,
        output: {
          status: 'help',
          usage:
            '--input FILE_OR_DIRECTORY [--input-format result|manual-report|full-planner-run|run-telemetry] --destination ID --artifact ID --prepared-at UTC --base-url URL --server-version 3.163.0 (--preview-out FILE | --publish --approve-sha256 HASH)',
          documentation: 'tools/evals-langfuse/README.md',
        },
      };
    }
    const input = required(values.input);
    const artifactId = required(values.artifact);
    const preparedAt = required(values['prepared-at']);
    const inputFormat = values['input-format'];
    if (
      ![
        'result',
        'manual-report',
        'full-planner-run',
        'run-telemetry',
      ].includes(inputFormat)
    )
      throw new Error();
    const fullRun = inputFormat === 'full-planner-run';
    if (
      !fullRun &&
      names.some((name) =>
        ['max-publications', 'max-preview-bytes'].includes(name),
      )
    )
      throw new Error();
    if (values.publish) {
      if (
        values['preview-out'] !== undefined ||
        !/^[a-f0-9]{64}$/.test(values['approve-sha256'] ?? '')
      )
        throw new Error();
    } else if (values['approve-sha256'] !== undefined) {
      throw new Error();
    }
    const previewPath = values.publish
      ? undefined
      : required(values['preview-out']);

    code = 'invalid_configuration';
    if (values['server-version'] !== '3.163.0') throw new Error();
    const baseUrl = required(values['base-url']);
    const url = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      /\s/.test(baseUrl) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    const config = {
      serverVersion: '3.163.0' as const,
      destinationId: required(values.destination),
      baseUrl,
      maxBatchBytes: limit(values['max-batch-bytes'], 3_500_000),
      timeoutMs: limit(values['timeout-ms'], 300_000),
      shutdownTimeoutMs: limit(values['shutdown-timeout-ms'], 60_000),
      maxInFlight: limit(values['max-in-flight'], 16),
    };
    const maxPublicationBytes = limit(
      values['max-publication-bytes'],
      config.maxBatchBytes,
    );

    const inputLimit = limit(values['max-input-bytes'], 128 * 1024 * 1024);
    const maxPublications = fullRun
      ? limit(values['max-publications'], 10_000)
      : 1;
    const maxPreviewBytes = limit(
      values['max-preview-bytes'],
      64 * 1024 * 1024,
    );

    code = 'invalid_input';
    let source: ReturnType<typeof importFullPlannerRun>['source'] | undefined;
    let samples: {
      result: EvaluationResult<unknown> | RunTelemetryResult;
      metadata?: EvaluationPublicationMetadata;
    }[];
    if (fullRun) {
      const records = await readBoundedInput(
        join(input, 'records.json'),
        inputLimit,
      );
      const summary = await readBoundedInput(
        join(input, 'summary.json'),
        inputLimit - records.byteLength,
      );
      const imported = importFullPlannerRun(records, summary, maxPublications);
      source = imported.source;
      samples = imported.samples;
    } else {
      const inputJson: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          await readBoundedInput(input, inputLimit),
        ),
      );
      samples = [
        {
          result:
            inputFormat === 'run-telemetry'
              ? (inputJson as RunTelemetryResult)
              : readResult(
                  inputFormat === 'manual-report' && isObject(inputJson)
                    ? inputJson.result
                    : inputJson,
                ),
        },
      ];
    }
    const prepare = (
      sample: (typeof samples)[number],
      review: (publication: EvaluationPublication) => boolean,
    ) =>
      inputFormat === 'run-telemetry'
        ? prepareRunTelemetryPublication(sample.result as RunTelemetryResult, {
            destinationId: config.destinationId,
            artifactId,
            preparedAt,
            policy: { maxBytes: maxPublicationBytes, review },
          })
        : prepareEvaluationPublication(
            sample.result as EvaluationResult<unknown>,
            {
              destinationId: config.destinationId,
              artifactId,
              preparedAt,
              metadata: sample.metadata,
              policy: { maxBytes: maxPublicationBytes, review },
            },
          );
    const candidates: EvaluationPublication[] = [];
    let candidateBytes = 0;
    const previewOnly = new Error();
    for (const sample of samples) {
      try {
        prepare(sample, (publication) => {
          if (fullRun) mapLangfuseV3Publication(publication, config);
          candidateBytes += Buffer.byteLength(JSON.stringify(publication));
          if (fullRun && candidateBytes > maxPreviewBytes) throw new Error();
          candidates.push(publication);
          // Preview never adds candidates to the core publisher's reviewed-object set.
          throw previewOnly;
        });
      } catch (error) {
        if (error !== previewOnly) throw error;
      }
    }
    const json = `${JSON.stringify(
      fullRun
        ? {
            schemaVersion: 2,
            inputFormat,
            source,
            limits: {
              maxInputBytes: inputLimit,
              maxPublicationBytes,
              maxEntries: maxPublications,
              maxPreviewBytes,
            },
            sink: config,
            publications: candidates,
          }
        : {
            schemaVersion: 1,
            inputFormat,
            limits: {
              maxInputBytes: inputLimit,
              maxPublicationBytes,
              maxEntries: 1,
            },
            sink: config,
            publication: candidates[0],
          },
      null,
      2,
    )}\n`;
    if (fullRun && Buffer.byteLength(json) > maxPreviewBytes) throw new Error();
    const approvalSha256 = createHash('sha256').update(json).digest('hex');
    const identifiers: Record<string, string | number> = fullRun
      ? {
          approvalSha256,
          publications: candidates.length,
          bytes: candidates.reduce(
            (sum, publication) => sum + publication.bytes,
            0,
          ),
        }
      : {
          approvalSha256,
          publicationId: candidates[0].publicationId,
          payloadDigest: candidates[0].payloadDigest,
          bytes: candidates[0].bytes,
        };
    if (!values.publish) {
      code = 'preview_write_failed';
      await writeFile(required(previewPath), json, { flag: 'wx', mode: 0o600 });
      return {
        exitCode: 0,
        output: { mode: 'preview', status: 'preview', ...identifiers },
      };
    }
    code = 'approval_mismatch';
    if (approvalSha256 !== values['approve-sha256']) throw new Error();
    const approved = samples.map((sample, index) =>
      prepare(
        sample,
        (publication) =>
          publication.publicationId === candidates[index].publicationId &&
          publication.json === candidates[index].json,
      ),
    );

    code = 'invalid_credentials';
    const env = dependencies.env ?? process.env;
    const publicKey = required(env.LANGFUSE_PUBLIC_KEY);
    const secretKey = required(env.LANGFUSE_SECRET_KEY);
    code = 'sink_initialization_failed';
    const startSink = dependencies.startSink ?? startStandaloneSink;
    const sink = await startSink({ ...config, publicKey, secretKey });
    let status: PublicationStatus = 'uncertain';
    let shutdown: 'closed' | 'uncertain' = 'uncertain';
    const receipts: PublicationOutcome[] = [];
    try {
      const publisher = createEvaluationPublisher({
        destinationId: config.destinationId,
        sink,
        timeoutMs: config.timeoutMs,
        maxEntries: maxPublications,
      });
      for (const publication of approved) {
        let receipt: PublicationOutcome;
        try {
          receipt = await publisher.publish(publication);
        } catch {
          receipt = {
            publicationId: publication.publicationId,
            payloadDigest: publication.payloadDigest,
            status: 'uncertain',
            reason: 'sink_error',
          };
        }
        receipts.push(receipt);
        status = receipt.status;
        if (status !== 'accepted') {
          if (receipts.length > 1) status = 'partial';
          break;
        }
      }
    } catch {
      status = receipts.length > 0 ? 'partial' : 'uncertain';
    } finally {
      try {
        shutdown =
          (await sink.shutdown()) === 'closed' ? 'closed' : 'uncertain';
      } catch {
        shutdown = 'uncertain';
      }
    }
    const exitCode =
      shutdown !== 'closed' || status === 'partial' || status === 'uncertain'
        ? 3
        : status === 'failed'
          ? 1
          : 0;
    return {
      exitCode,
      output: {
        mode: 'publish',
        ...identifiers,
        status,
        shutdown,
        ...(fullRun && { receipts, unsent: approved.length - receipts.length }),
      },
    };
  } catch {
    return { exitCode: 2, output: { status: 'invalid', code } };
  }
}

async function startStandaloneSink(
  config: LangfuseV3Config,
): Promise<LangfuseV3Sink> {
  const controls = {
    LANGFUSE_DEBUG: 'false',
    LANGFUSE_LOG_LEVEL: 'NONE',
    LANGFUSE_FLUSH_AT: undefined,
    LANGFUSE_FLUSH_INTERVAL: undefined,
  };
  const original = Object.keys(controls).map(
    (name) => [name, process.env[name]] as const,
  );
  try {
    for (const [name, value] of Object.entries(controls)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    // The pinned SDK captures logger settings at import and flush settings at construction.
    return (await import('./sink.ts')).startLangfuseV3Sink(config);
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function required(value: string | undefined): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error();
  return value;
}

function limit(value: string, max: number): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > max) throw new Error();
  return number;
}

async function readBoundedInput(
  path: string,
  maxBytes: number,
): Promise<Buffer> {
  if (maxBytes < 1) throw new Error();
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error();
    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        size,
        buffer.length - size,
        null,
      );
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > stat.size) throw new Error();
    return buffer.subarray(0, size);
  } finally {
    await file.close();
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readResult(value: unknown): EvaluationResult<unknown> {
  if (
    !isObject(value) ||
    !isObject(value.identity) ||
    !Array.isArray(value.failures) ||
    !value.failures.every((failure) => typeof failure === 'string') ||
    !Array.isArray(value.records) ||
    (value.cleanupError !== undefined &&
      typeof value.cleanupError !== 'string') ||
    (value.error !== undefined &&
      (!isObject(value.error) || typeof value.error.message !== 'string'))
  )
    throw new Error();
  for (const [index, record] of value.records.entries()) {
    if (
      !isObject(record) ||
      record.sampleKey !== value.sampleKey ||
      record.sequence !== index ||
      typeof record.kind !== 'string' ||
      !['turn', 'stage', 'diagnostic'].includes(record.kind) ||
      !Object.hasOwn(record, 'value') ||
      (record.producer !== undefined && typeof record.producer !== 'string') ||
      (record.requestId !== undefined && typeof record.requestId !== 'string')
    )
      throw new Error();
  }
  // Core preparation validates identity, enums, sample linkage and the bounded summary.
  return value as unknown as EvaluationResult<unknown>;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = await runLangfuseCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.output)}\n`, () => {
    // An uncertain shutdown may leave sockets alive; exiting does not prove remote cancellation.
    process.exit(result.exitCode);
  });
}
