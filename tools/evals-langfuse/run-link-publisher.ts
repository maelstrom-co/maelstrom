import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LangfuseClient } from '@langfuse/client';
import type { RunLinkPlan, RunLinkRequest } from './run-links.ts';

type Create = LangfuseClient['api']['datasetRunItems']['create'];

/** Borrowed or caller-owned public API client; contains no trace/item upsert methods. */
export interface RunLinkClient {
  /** Exactly one SDK POST, with retries disabled by the publisher. */
  create(
    request: RunLinkRequest,
    options: NonNullable<Parameters<Create>[1]>,
  ): Promise<Awaited<ReturnType<Create>>>;
  /** Disposes owned SDK resources after outstanding requests settle. */
  shutdown(): Promise<void>;
}

/** One-shot sequential import with a durable attempt-before-send journal. Never resumes it. */
export async function publishRunLinks(options: {
  readonly plan: RunLinkPlan;
  readonly approvalSha256: string;
  readonly journalPath: string;
  readonly timeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly startClient: () => RunLinkClient | Promise<RunLinkClient>;
}) {
  const { plan, approvalSha256, journalPath, timeoutMs, shutdownTimeoutMs } =
    options;
  // O_EXCL rejects symlinks and competing processes, including journals left by a crash.
  const journal = await open(
    journalPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  const append = async (entry: unknown) => {
    await journal.writeFile(`${JSON.stringify(entry)}\n`);
    await journal.sync();
  };
  let client: RunLinkClient | undefined;
  let pending: Promise<Awaited<ReturnType<Create>>> | undefined;
  let attempted = 0;
  let accepted = 0;
  let shutdown: 'closed' | 'uncertain' = 'closed';
  let status: 'accepted' | 'partial' | 'uncertain' | 'failed' = 'failed';
  let runId: string | undefined;
  const ids = new Set<string>();
  try {
    await append({
      schemaVersion: 1,
      approvalSha256,
      manifestSha256: plan.manifestSha256,
      runName: plan.requests[0].runName,
      status: 'started',
    });
    const directory = await open(dirname(journalPath), constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    client = await options.startClient();
    for (const [index, request] of plan.requests.entries()) {
      await append({ index, status: 'attempting', request });
      attempted++;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const activeClient = client;
        pending = Promise.resolve().then(() =>
          activeClient.create(request, {
            maxRetries: 0,
            abortSignal: controller.signal,
            timeoutInSeconds: timeoutMs / 1_000,
          }),
        );
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Deadline'));
          }, timeoutMs);
        });
        const receipt = await Promise.race([pending, timeout]);
        if (
          controller.signal.aborted ||
          !receipt ||
          !validId(receipt.id) ||
          !validId(receipt.datasetRunId) ||
          receipt.datasetRunName !== request.runName ||
          receipt.datasetItemId !== request.datasetItemId ||
          receipt.traceId !== request.traceId ||
          receipt.observationId != null ||
          (runId !== undefined && receipt.datasetRunId !== runId) ||
          ids.has(receipt.id)
        )
          throw new Error('Unconfirmed association');
        await append({
          index,
          status: 'accepted',
          id: receipt.id,
          datasetRunId: receipt.datasetRunId,
        });
        runId = receipt.datasetRunId;
        ids.add(receipt.id);
        accepted++;
      } catch {
        await append({
          index,
          status: 'uncertain',
          reconciliationRequired: true,
        });
        break;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    status =
      accepted === plan.requests.length
        ? 'accepted'
        : accepted > 0
          ? 'partial'
          : 'uncertain';
  } catch {
    status = accepted > 0 ? 'partial' : attempted > 0 ? 'uncertain' : 'failed';
  } finally {
    if (client) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const activeClient = client;
      try {
        shutdown = await Promise.race([
          Promise.resolve(pending)
            .catch(() => {})
            .then(() => activeClient.shutdown())
            .then(() => 'closed' as const),
          new Promise<'uncertain'>((resolve) => {
            timer = setTimeout(() => resolve('uncertain'), shutdownTimeoutMs);
          }),
        ]);
      } catch {
        shutdown = 'uncertain';
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    try {
      await append({
        status,
        attempted,
        accepted,
        unsent: plan.requests.length - attempted,
        shutdown,
      });
      await journal.close();
    } catch {
      status =
        accepted > 0 ? 'partial' : attempted > 0 ? 'uncertain' : 'failed';
      await journal.close().catch(() => {});
    }
  }
  return {
    status,
    attempted,
    accepted,
    unsent: plan.requests.length - attempted,
    shutdown,
  };
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
