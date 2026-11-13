import {
  OSS_PREVIEW_STACKS,
  OSS_PREVIEW_STATE_STORE_WORKER,
  OSS_PREVIEW_STAGE_PATTERN,
} from '../infra/platform/src/PreviewStateStoreContract.ts';

/** Fully resolved request inspected before a state-isolation network send. */
export interface PreviewStateHttpRequest {
  /** Absolute destination; relative and redirect destinations are rejected. */
  readonly url: string;
  /** Actual HTTP method after SDK preprocessing. */
  readonly method: string;
  /** In-memory JSON body, used only for named-secret creation validation. */
  readonly jsonBody?: unknown;
}

/** Fixed account and endpoints for one preview-only transfer. */
export interface PreviewStateHttpPolicy {
  /** Operator-verified preview account, distinct from production. */
  readonly accountId: string;
  /** Account subdomain including workers.dev. */
  readonly workersDevSuffix: string;
  /** Exact HTTPS exchange URLs returned by the authenticated preview-session API. */
  readonly exchangeUrls: ReadonlySet<string>;
  /** Only scopes captured before destination creation may receive data. */
  readonly destinationScopes: ReadonlySet<string>;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Permits the existing source's reads and only the new backend's mutations. */
export function allowsPreviewStateRequest(
  request: PreviewStateHttpRequest,
  policy: PreviewStateHttpPolicy,
) {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    !/^[0-9a-f]{32}$/.test(policy.accountId) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*\.workers\.dev$/.test(policy.workersDevSuffix)
  )
    return false;
  const method = request.method.toUpperCase();
  if (method === 'GET' && policy.exchangeUrls.has(url.href)) return true;
  const sourceHost = `alchemy-state-store.${policy.workersDevSuffix}`;
  const targetHost = `${OSS_PREVIEW_STATE_STORE_WORKER}.${policy.workersDevSuffix}`;
  if (url.hostname === sourceHost || url.hostname === targetHost) {
    if (url.port) return false;
    if (
      method === 'GET' &&
      (url.pathname === '/' ||
        url.pathname === '/version' ||
        url.pathname === '/state/stacks')
    )
      return true;
    if (
      url.hostname === targetHost &&
      method === 'DELETE' &&
      url.pathname === '/state/stacks/CloudflareStateStore' &&
      !url.search
    )
      return true;
    const segments = url.pathname.split('/').slice(1);
    if (
      segments[0] !== 'state' ||
      segments[1] !== 'stacks' ||
      !OSS_PREVIEW_STACKS.some((item) => item.stack === segments[2])
    )
      return false;
    if (method === 'GET' && segments.length === 4 && segments[3] === 'stages')
      return true;
    if (
      segments[3] !== 'stages' ||
      !OSS_PREVIEW_STAGE_PATTERN.test(segments[4] ?? '')
    )
      return false;
    const tail = segments.slice(5);
    const read =
      (tail.length === 1 &&
        ['resources', 'output', 'replaced-resources'].includes(
          tail[0] ?? '',
        )) ||
      (tail.length === 2 && tail[0] === 'resources' && !!tail[1]);
    if (method === 'GET') return read;
    return (
      url.hostname === targetHost &&
      method === 'PUT' &&
      policy.destinationScopes.has(`${segments[2]}/${segments[4]}`) &&
      ((tail.length === 1 && tail[0] === 'output') ||
        (tail.length === 2 && tail[0] === 'resources' && !!tail[1])) &&
      !url.search
    );
  }
  if (url.hostname !== 'api.cloudflare.com' || url.port) return false;
  const prefix = `/client/v4/accounts/${policy.accountId}`;
  if (!url.pathname.startsWith(`${prefix}/`)) return false;
  if (method === 'GET' || method === 'HEAD') return true;
  const script = `${prefix}/workers/scripts/`;
  if (url.pathname === `${script}alchemy-state-store/edge-preview`)
    return method === 'POST';
  if (
    url.pathname === `${script}${OSS_PREVIEW_STATE_STORE_WORKER}/edge-preview`
  )
    return method === 'POST';
  if (url.pathname === `${script}${OSS_PREVIEW_STATE_STORE_WORKER}`)
    return method === 'PUT';
  if (url.pathname === `${script}${OSS_PREVIEW_STATE_STORE_WORKER}/subdomain`)
    return method === 'POST';
  const secretCollection = new RegExp(
    `^${prefix}/secrets_store/stores/[A-Za-z0-9_-]+/secrets$`,
  );
  if (
    method !== 'POST' ||
    !secretCollection.test(url.pathname) ||
    !Array.isArray(request.jsonBody) ||
    request.jsonBody.length < 1 ||
    request.jsonBody.length > 2
  )
    return false;
  const suffix = OSS_PREVIEW_STATE_STORE_WORKER.replace(/[^A-Za-z0-9_]/g, '_');
  const names = new Set([
    `AlchemyStateStoreToken_${suffix}`,
    `AlchemyStateStoreEncryptionKey_${suffix}`,
  ]);
  return request.jsonBody.every(
    (value) =>
      object(value) &&
      typeof value.name === 'string' &&
      names.has(value.name) &&
      typeof value.value === 'string' &&
      /^[0-9a-f]{64}$/.test(value.value) &&
      Array.isArray(value.scopes) &&
      value.scopes.length === 1 &&
      value.scopes[0] === 'workers' &&
      Object.keys(value).every((key) =>
        ['name', 'value', 'scopes', 'comment'].includes(key),
      ),
  );
}
