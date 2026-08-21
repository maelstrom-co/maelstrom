const ABSENT_WORKER_CODES = new Set([10007, 10090]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unknown error';

const requiredEnvironmentVariable = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

export const previewWorkerNames = (prNumber: string) => {
  if (!/^[1-9]\d*$/.test(prNumber)) {
    throw new Error(`Invalid pull request number: ${prNumber}`);
  }

  return [
    `maelstrom-www-pr-${prNumber}`,
    `maelstrom-www-alchemy-pr-${prNumber}`,
    `maelstrom-docs-pr-${prNumber}`,
    `maelstrom-docs-alchemy-pr-${prNumber}`,
    `maelstrom-playground-pr-${prNumber}`,
    `maelstrom-playground-alchemy-pr-${prNumber}`,
  ];
};

interface CloudflareEnvelope {
  readonly success: boolean;
  readonly errors: readonly Record<string, unknown>[];
}

const parseEnvelope = (body: string): CloudflareEnvelope | undefined => {
  if (body.trim() === '') {
    return undefined;
  }

  const value: unknown = JSON.parse(body);
  if (!isRecord(value) || typeof value.success !== 'boolean') {
    throw new Error('Cloudflare returned an invalid response envelope');
  }

  if (!Array.isArray(value.errors) || !value.errors.every(isRecord)) {
    throw new Error('Cloudflare returned an invalid errors collection');
  }

  return { success: value.success, errors: value.errors };
};

const isAbsentWorker = (envelope: CloudflareEnvelope | undefined) =>
  envelope?.success === false &&
  envelope.errors.length > 0 &&
  envelope.errors.every(
    (error) =>
      typeof error.code === 'number' && ABSENT_WORKER_CODES.has(error.code),
  );

const responseSummary = (response: Response, body: string) => {
  const summary = body.replaceAll(/\s+/g, ' ').trim().slice(0, 500);
  return `HTTP ${response.status}${summary ? `: ${summary}` : ''}`;
};

export interface DeletePreviewWorkersOptions {
  readonly accountId: string;
  readonly apiToken: string;
  readonly prNumber: string;
  readonly attempts?: number;
  readonly retryDelayMs?: number;
  readonly requestTimeoutMs?: number;
}

interface DeletePreviewWorkersDependencies {
  readonly fetch: typeof fetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

const defaultDependencies: DeletePreviewWorkersDependencies = {
  fetch,
  sleep: async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
  log: console.log,
  error: console.error,
};

export const deletePreviewWorkers = async (
  options: DeletePreviewWorkersOptions,
  dependencies: DeletePreviewWorkersDependencies = defaultDependencies,
) => {
  const {
    accountId,
    apiToken,
    prNumber,
    attempts = 3,
    retryDelayMs = 15_000,
    requestTimeoutMs = 30_000,
  } = options;
  const workers = previewWorkerNames(prNumber);
  let finalPassFailed = false;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    dependencies.log(`Preview deletion pass ${attempt} of ${attempts}`);
    let passFailed = false;

    for (const workerName of workers) {
      try {
        const url = new URL(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`,
        );
        url.searchParams.set('force', 'true');
        const response = await dependencies.fetch(url, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${apiToken}` },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        const body = await response.text();
        const envelope = parseEnvelope(body);

        if (response.ok && (envelope === undefined || envelope.success)) {
          dependencies.log(`Deleted preview Worker ${workerName}.`);
          continue;
        }
        if (!response.ok && isAbsentWorker(envelope)) {
          dependencies.log(
            `No preview Worker named ${workerName}; nothing to tear down.`,
          );
          continue;
        }

        dependencies.error(
          `Failed to delete preview Worker ${workerName}: ${responseSummary(response, body)}`,
        );
        passFailed = true;
      } catch (error) {
        dependencies.error(
          `Failed to delete preview Worker ${workerName}: ${errorMessage(error)}`,
        );
        passFailed = true;
      }
    }

    finalPassFailed = passFailed;
    if (attempt < attempts) {
      await dependencies.sleep(retryDelayMs);
    }
  }

  return !finalPassFailed;
};

if (import.meta.main) {
  const success = await deletePreviewWorkers({
    accountId: requiredEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID'),
    apiToken: requiredEnvironmentVariable('CLOUDFLARE_API_TOKEN'),
    prNumber: requiredEnvironmentVariable('PR_NUMBER'),
  });

  if (!success) {
    console.error(
      'Preview Worker deletion still failed after the final attempt.',
    );
    process.exitCode = 1;
  }
}
