import type { NarrationDeliveryEnv } from './NarrationDelivery.js';
import { narrationDelivery } from './NarrationDeliveryContract.js';

const manifest = /^manifests\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/u;
const media = /^([a-f0-9]{64})\/(0|[1-9][0-9]{0,3})\.wav$/u;
const digest = /^[a-f0-9]{64}$/u;
const deliveryPrefix = 'production-delivery';
const maxManifestBytes = 25 * 1024 * 1024;

interface Metadata {
  size: number;
  httpEtag: string;
}

interface ByteRange {
  offset: number;
  length: number;
}

type DeliveryEnv = {
  NARRATION_BUCKET: {
    head(key: string): Promise<Metadata | null>;
    get(
      key: string,
      options?: { range: ByteRange },
    ): Promise<(Metadata & { body: ReadableStream }) | null>;
  };
};

function empty(status: number, headers?: Record<string, string>) {
  const result = new Headers(headers);
  result.set('cache-control', 'no-store');
  return new Response(null, { status, headers: result });
}

function byteRange(value: string, size: number) {
  const match = /^bytes=([0-9]*)-([0-9]*)$/iu.exec(value);
  if (!match || (!match[1] && !match[2])) return;
  if (!size) return null;

  if (!match[1]) {
    const length = Math.min(Number(match[2]), size);
    return length > 0 ? { offset: size - length, length } : null;
  }

  const offset = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return offset <= end ? { offset, length: end - offset + 1 } : null;
}

type Bucket = DeliveryEnv['NARRATION_BUCKET'];

async function readCommitPointer(bucket: Bucket, version: string) {
  const key = `${deliveryPrefix}/committed/${version}.json`;
  const object = await bucket.get(key);
  if (!object) return;
  if (object.size > 512) {
    await object.body.cancel();
    return;
  }
  try {
    const data: unknown = await new Response(object.body).json();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function isCommitted(bucket: Bucket, version: string, index: number) {
  const pointer = await readCommitPointer(bucket, version);
  const voiceHash = pointer?.voiceHash;
  const textHash = pointer?.textHash;
  const chunkCount = pointer?.chunkCount;
  if (
    typeof voiceHash !== 'string' ||
    !digest.test(voiceHash) ||
    typeof textHash !== 'string' ||
    !digest.test(textHash) ||
    typeof chunkCount !== 'number' ||
    !Number.isSafeInteger(chunkCount) ||
    chunkCount > 10_000 ||
    index >= chunkCount
  )
    return false;

  // The publisher writes the immutable manifest last, after all listed chunks.
  const manifest = await bucket.head(
    `${deliveryPrefix}/manifests/${voiceHash}/${textHash}.json`,
  );
  return manifest !== null && manifest.size <= maxManifestBytes;
}

async function serve(request: Request, env: DeliveryEnv) {
  const url = new URL(request.url);
  if (
    !narrationDelivery.hosts.some((host) => url.hostname === host) ||
    !url.pathname.startsWith(narrationDelivery.path)
  ) {
    return empty(404);
  }

  const path = url.pathname.slice(narrationDelivery.path.length);
  const isManifest = manifest.test(path);
  const chunk = media.exec(path);
  if (!isManifest && !chunk) return empty(404);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return empty(405, { allow: 'GET, HEAD' });
  }

  const key = `${deliveryPrefix}/${path}`;
  const bucket = env.NARRATION_BUCKET;
  if (chunk && !(await isCommitted(bucket, chunk[1], Number(chunk[2])))) {
    return empty(404);
  }
  const head = request.method === 'HEAD';
  const rangeHeader = request.headers.get('range');
  const metadata = head || rangeHeader ? await bucket.head(key) : undefined;
  if (
    metadata === null ||
    (isManifest && metadata && metadata.size > maxManifestBytes)
  )
    return empty(404);

  const ifRange = request.headers.get('if-range');
  const range =
    !head &&
    metadata &&
    rangeHeader &&
    (!ifRange || ifRange === metadata.httpEtag)
      ? byteRange(rangeHeader, metadata.size)
      : undefined;

  if (range === null) {
    return empty(416, {
      'accept-ranges': 'bytes',
      'content-range': `bytes */${metadata?.size}`,
    });
  }

  const object = head ? null : await bucket.get(key, range && { range });
  const properties = head ? metadata : object;
  if (!properties) return empty(404);
  if (isManifest && properties.size > maxManifestBytes) {
    await object?.body.cancel();
    return empty(404);
  }
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
    'content-length': String(range?.length ?? properties.size),
    'content-type': isManifest ? 'application/json' : 'audio/wav',
    etag: properties.httpEtag,
    'x-content-type-options': 'nosniff',
  });
  if (range) {
    const { offset, length } = range;
    headers.set(
      'content-range',
      `bytes ${offset}-${offset + length - 1}/${properties.size}`,
    );
  }
  return new Response(object?.body ?? null, {
    status: range ? 206 : 200,
    headers,
  });
}

export default {
  fetch: serve,
} satisfies {
  fetch(request: Request, env: NarrationDeliveryEnv): Promise<Response>;
};
