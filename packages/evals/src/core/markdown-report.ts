import { randomUUID } from 'node:crypto';
import { open, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createEvaluationPublisher,
  type EvaluationResultSink,
  type MarkdownReport,
  prepareMarkdownReportPublication,
} from './publication.js';

const MAX_REPORT_BYTES = 16 * 1024 * 1024;

/**
 * Creates a local file sink. The caller chooses the path, never publication content.
 * Acceptance means atomic replacement, not fsync or durable storage.
 */
export function createMarkdownFileSink(options: {
  readonly path: string;
  readonly destinationId: string;
  readonly maxBytes: number;
}): EvaluationResultSink {
  const { path, destinationId, maxBytes } = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !destinationId.trim())
    throw new Error('Invalid Markdown sink configuration');
  const target = resolve(path);
  return {
    async publish(publication, signal) {
      if (signal.aborted) return { status: 'failed' };
      if (
        publication.destinationId !== destinationId ||
        Buffer.byteLength(publication.json) > maxBytes
      )
        return { status: 'failed' };
      let markdown: string;
      try {
        const envelope = JSON.parse(publication.json);
        const expected = prepareMarkdownReportPublication(
          {
            runId: envelope.identity.runId,
            reportId: envelope.identity.reportId,
            markdown: envelope.markdown,
          },
          {
            destinationId,
            artifactId: publication.artifactId,
            preparedAt: envelope.preparedAt,
            policy: { maxBytes, review: () => true },
          },
        );
        // Reconstructing checks version, scope, canonical bytes and every sealed identity.
        if (
          expected.json !== publication.json ||
          expected.bytes !== publication.bytes ||
          expected.payloadDigest !== publication.payloadDigest ||
          expected.publicationKey !== publication.publicationKey ||
          expected.publicationId !== publication.publicationId
        )
          return { status: 'failed' };
        markdown = envelope.markdown;
      } catch {
        return { status: 'failed' };
      }
      const temporary = join(
        dirname(target),
        `.markdown-report-${randomUUID()}.tmp`,
      );
      const file = await open(temporary, 'wx');
      try {
        await writeFile(file, markdown, { encoding: 'utf8', signal });
        await file.close();
        signal.throwIfAborted();
        await rename(temporary, target);
      } catch (error) {
        // Cleanup must not replace the original write, abort or rename failure.
        await file.close().catch(() => {});
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
      return { status: 'accepted' };
    },
  };
}

/** Publishes an existing renderer's output to an explicitly selected local file only. */
export async function writeMarkdownReport(
  path: string,
  report: MarkdownReport,
): Promise<void> {
  const destinationId = pathToFileURL(resolve(path)).href;
  const publication = prepareMarkdownReportPublication(report, {
    destinationId,
    artifactId: report.reportId,
    policy: {
      maxBytes: MAX_REPORT_BYTES,
      // Local report writers already expose these bytes; this is not remote privacy approval.
      review: (value) =>
        value.destinationId === destinationId &&
        JSON.parse(value.json).markdown === report.markdown,
    },
  });
  const publisher = createEvaluationPublisher({
    destinationId,
    sink: createMarkdownFileSink({
      path,
      destinationId,
      maxBytes: MAX_REPORT_BYTES,
    }),
    timeoutMs: 30_000,
    maxEntries: 1,
  });
  const outcome = await publisher.publish(publication);
  if (outcome.status !== 'accepted')
    throw new Error(
      `Markdown report publication ${outcome.status}: ${outcome.reason}`,
    );
}
