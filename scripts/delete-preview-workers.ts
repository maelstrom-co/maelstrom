const ABSENT_WORKER_CODES = new Set([10007, 10090]);
const MAX_ATTEMPTS = 20;
const MAX_CONCURRENCY = 6;
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOTAL_BUDGET_MS = 600_000;
const MAX_RECONCILIATION_CANDIDATES = 200;
const PREVIEW_WORKER_PATTERN =
  /^maelstrom-(?:www|docs|playground)(?:-alchemy)?-pr-([1-9]\d*)$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unknown error';

const validatePrNumber = (prNumber: string) => {
  if (!/^[1-9]\d*$/.test(prNumber)) {
    throw new Error(`Invalid pull request number: ${prNumber}`);
  }
};

/** Returns Worker names that predate the Alchemy preview stacks. */
export const legacyPreviewWorkerNames = (prNumber: string) => {
  validatePrNumber(prNumber);
  return [
    `maelstrom-www-pr-${prNumber}`,
    `maelstrom-docs-pr-${prNumber}`,
    `maelstrom-playground-pr-${prNumber}`,
  ];
};

/** Returns Worker names owned by the current Alchemy preview stacks. */
export const currentPreviewWorkerNames = (prNumber: string) => {
  validatePrNumber(prNumber);
  return [
    `maelstrom-www-alchemy-pr-${prNumber}`,
    `maelstrom-docs-alchemy-pr-${prNumber}`,
    `maelstrom-playground-alchemy-pr-${prNumber}`,
  ];
};

/** Returns every preview Worker name that teardown may delete for one PR. */
export const previewWorkerNames = (prNumber: string) => [
  ...legacyPreviewWorkerNames(prNumber),
  ...currentPreviewWorkerNames(prNumber),
];

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

const retryAfterMs = (response: Response, now: number) => {
  const value = response.headers.get('retry-after');
  if (!value) {
    return 0;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_TOTAL_BUDGET_MS);
  }

  const date = Date.parse(value);
  return Number.isNaN(date)
    ? 0
    : Math.min(Math.max(0, date - now), MAX_TOTAL_BUDGET_MS);
};

const validateCredential = (name: string, value: string) => {
  if (value.trim() === '' || /\s/.test(value)) {
    throw new Error(`${name} must be a non-empty value without whitespace`);
  }
};

const validateAccountId = (accountId: string) => {
  validateCredential('accountId', accountId);
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(accountId)) {
    throw new Error('accountId must be one Cloudflare account identifier');
  }
};

const validateInteger = (
  name: string,
  value: number,
  minimum: number,
  maximum: number,
) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
};

/** Controls strict, bounded deletion of preview Workers. */
export interface DeletePreviewWorkersOptions {
  /** Cloudflare account that exclusively contains preview Workers. */
  readonly accountId: string;
  /** Token with permission to delete scripts in the preview account. */
  readonly apiToken: string;
  /** Pull request whose exact allowlisted Worker names may be deleted. */
  readonly prNumber: string;
  /** Ordered reconciliation passes. Only the final pass determines success. */
  readonly attempts?: number;
  /** Base delay between ordered passes. */
  readonly retryDelayMs?: number;
  /** Maximum duration of one Cloudflare request. */
  readonly requestTimeoutMs?: number;
  /** Hard wall-clock budget for all requests and sleeps. */
  readonly totalBudgetMs?: number;
  /** Maximum simultaneous deletions within one pass. */
  readonly concurrency?: number;
  /** Name generation to use for migration cleanup or complete teardown. */
  readonly workerScope?: 'all' | 'current' | 'legacy';
  /** Revalidates authority immediately before each direct deletion request. */
  readonly authorize?: (workerName: string) => Promise<boolean>;
}

interface DeletePreviewWorkersDependencies {
  readonly fetch: typeof fetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly now: () => number;
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

const defaultDependencies: DeletePreviewWorkersDependencies = {
  fetch,
  sleep: async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
  now: Date.now,
  log: console.log,
  error: console.error,
};

/**
 * Deletes only allowlisted preview Workers and returns false when the final
 * pass fails or the total cleanup budget cannot preserve another full pass.
 */
export const deletePreviewWorkers = async (
  options: DeletePreviewWorkersOptions,
  dependencies: DeletePreviewWorkersDependencies = defaultDependencies,
) => {
  const {
    accountId,
    apiToken,
    prNumber,
    attempts = 6,
    retryDelayMs = 60_000,
    requestTimeoutMs = 30_000,
    totalBudgetMs = 540_000,
    concurrency = 6,
    workerScope = 'all',
    authorize,
  } = options;
  validateAccountId(accountId);
  validateCredential('apiToken', apiToken);
  validatePrNumber(prNumber);
  validateInteger('attempts', attempts, 1, MAX_ATTEMPTS);
  validateInteger('retryDelayMs', retryDelayMs, 0, MAX_RETRY_DELAY_MS);
  validateInteger(
    'requestTimeoutMs',
    requestTimeoutMs,
    1,
    MAX_REQUEST_TIMEOUT_MS,
  );
  validateInteger('totalBudgetMs', totalBudgetMs, 1, MAX_TOTAL_BUDGET_MS);
  validateInteger('concurrency', concurrency, 1, MAX_CONCURRENCY);
  if (!['all', 'current', 'legacy'].includes(workerScope)) {
    throw new Error('workerScope must be all, current, or legacy');
  }

  const workers =
    workerScope === 'legacy'
      ? legacyPreviewWorkerNames(prNumber)
      : workerScope === 'current'
        ? currentPreviewWorkerNames(prNumber)
        : previewWorkerNames(prNumber);
  const deadline = dependencies.now() + totalBudgetMs;
  let finalPassFailed = false;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (dependencies.now() >= deadline) {
      dependencies.error('Preview deletion exhausted its total time budget.');
      return false;
    }

    dependencies.log(`Preview deletion pass ${attempt} of ${attempts}`);
    let passFailed = false;
    let nextRetryDelayMs = retryDelayMs;

    for (let offset = 0; offset < workers.length; offset += concurrency) {
      const remainingMs = deadline - dependencies.now();
      if (remainingMs <= 0) {
        dependencies.error('Preview deletion exhausted its total time budget.');
        return false;
      }
      const timeoutMs = Math.max(1, Math.min(requestTimeoutMs, remainingMs));
      const results = await Promise.all(
        workers.slice(offset, offset + concurrency).map(async (workerName) => {
          try {
            if (authorize && !(await authorize(workerName))) {
              dependencies.log(
                `Skipped preview Worker ${workerName}; cleanup authority changed.`,
              );
              return { failed: false, retryAfterMs: 0 };
            }
            const url = new URL(
              `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`,
            );
            url.searchParams.set('force', 'true');
            const response = await dependencies.fetch(url, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${apiToken}` },
              signal: AbortSignal.timeout(timeoutMs),
            });
            const body = await response.text();
            const envelope = parseEnvelope(body);

            if (
              response.ok &&
              (envelope === undefined ||
                (envelope.success && envelope.errors.length === 0))
            ) {
              dependencies.log(`Deleted preview Worker ${workerName}.`);
              return { failed: false, retryAfterMs: 0 };
            }
            if (!response.ok && isAbsentWorker(envelope)) {
              dependencies.log(
                `No preview Worker named ${workerName}; nothing to tear down.`,
              );
              return { failed: false, retryAfterMs: 0 };
            }

            dependencies.error(
              `Failed to delete preview Worker ${workerName}: ${responseSummary(response, body)}`,
            );
            return {
              failed: true,
              retryAfterMs:
                response.status === 429 || response.status === 503
                  ? retryAfterMs(response, dependencies.now())
                  : 0,
            };
          } catch (error) {
            dependencies.error(
              `Failed to delete preview Worker ${workerName}: ${errorMessage(error)}`,
            );
            return { failed: true, retryAfterMs: 0 };
          }
        }),
      );
      passFailed ||= results.some((result) => result.failed);
      nextRetryDelayMs = Math.max(
        nextRetryDelayMs,
        ...results.map((result) => result.retryAfterMs),
      );
    }

    finalPassFailed = passFailed;
    if (attempt < attempts) {
      const remainingMs = deadline - dependencies.now();
      if (nextRetryDelayMs + requestTimeoutMs > remainingMs) {
        dependencies.error(
          'Preview deletion cannot start another full pass within its total time budget.',
        );
        return false;
      }
      await dependencies.sleep(nextRetryDelayMs);
    }
  }

  return !finalPassFailed;
};

/** Credentials used for strict preview candidate discovery. */
export interface DiscoverPreviewPrNumbersOptions {
  /** Cloudflare preview account to inspect. */
  readonly accountId: string;
  /** Token with permission to list scripts in the preview account. */
  readonly apiToken: string;
}

/**
 * Lists PR numbers derived only from exact current or legacy preview Worker
 * names. An invalid provider envelope aborts reconciliation without deletion.
 */
export const discoverPreviewPrNumbers = async (
  options: DiscoverPreviewPrNumbersOptions,
  dependencies: Pick<DeletePreviewWorkersDependencies, 'fetch'> = { fetch },
) => {
  validateAccountId(options.accountId);
  validateCredential('apiToken', options.apiToken);
  const url = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/workers/scripts`,
  );
  const response = await dependencies.fetch(url, {
    headers: { Authorization: `Bearer ${options.apiToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error(
      `Cloudflare returned an invalid Worker list: HTTP ${response.status}`,
    );
  }
  if (
    !response.ok ||
    !isRecord(value) ||
    value.success !== true ||
    !Array.isArray(value.errors) ||
    !value.errors.every(isRecord) ||
    value.errors.length !== 0 ||
    !Array.isArray(value.result) ||
    !value.result.every(isRecord)
  ) {
    throw new Error(
      `Cloudflare returned an invalid Worker list: HTTP ${response.status}`,
    );
  }

  const candidates = new Set<string>();
  for (const worker of value.result) {
    if (typeof worker.id !== 'string') continue;
    const match = PREVIEW_WORKER_PATTERN.exec(worker.id);
    if (match?.[1]) candidates.add(match[1]);
  }
  if (candidates.size > MAX_RECONCILIATION_CANDIDATES) {
    throw new Error(
      `Preview reconciliation found more than ${MAX_RECONCILIATION_CANDIDATES} candidates`,
    );
  }
  return [...candidates].sort((left, right) => Number(left) - Number(right));
};
