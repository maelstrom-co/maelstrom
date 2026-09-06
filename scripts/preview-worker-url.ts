const WORKER_NAME_PATTERN =
  /^maelstrom-(?:www|docs|playground)-alchemy-pr-[1-9]\d*$/;
const WORKERS_DEV_SUFFIX_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev$/;

/** Checks a complete account-specific workers.dev suffix without trailing characters. */
export const isWorkersDevSuffix = (value: string): boolean =>
  WORKERS_DEV_SUFFIX_PATTERN.exec(value)?.[0] === value;

/**
 * Validates a state-derived preview URL against one exact Worker identity and
 * the trusted preview account's workers.dev suffix.
 */
export const validatePreviewWorkerUrl = (
  value: string,
  expectedWorkerName: string,
  workersDevSuffix: string,
) => {
  if (!WORKER_NAME_PATTERN.test(expectedWorkerName)) {
    throw new Error('Expected preview Worker name is invalid');
  }
  if (!isWorkersDevSuffix(workersDevSuffix)) {
    throw new Error('Preview workers.dev suffix is missing or invalid');
  }

  const expectedHostname = `${expectedWorkerName}.${workersDevSuffix}`;
  const expectedUrl = `https://${expectedHostname}/`;
  if (value !== expectedUrl && value !== expectedUrl.slice(0, -1)) {
    throw new Error(`Preview state URL must be exactly ${expectedUrl}`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Preview state must contain an absolute URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hostname !== expectedHostname ||
    url.port !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(`Preview state URL must be exactly ${expectedUrl}`);
  }
  return url.href;
};

if (import.meta.main) {
  const [value, expectedWorkerName, workersDevSuffix] = Bun.argv.slice(2);
  if (!value || !expectedWorkerName || !workersDevSuffix) {
    throw new Error(
      'Usage: preview-worker-url.ts <url> <worker-name> <workers.dev-suffix>',
    );
  }
  process.stdout.write(
    validatePreviewWorkerUrl(value, expectedWorkerName, workersDevSuffix),
  );
}
