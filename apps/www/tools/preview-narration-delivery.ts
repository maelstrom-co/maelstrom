import type { S3Client } from 'bun';

export async function putPreviewNarrationAsset(
  client: Pick<S3Client, 'presign'>,
  path: string,
  value: string | Uint8Array,
  type: string,
) {
  const cacheControl =
    type === 'audio/wav' ? 'public, max-age=86400, immutable' : 'no-store';
  try {
    const url = client.presign(path, { method: 'PUT', expiresIn: 60, type });
    const result = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': type, 'cache-control': cacheControl },
      body: typeof value === 'string' ? value : Buffer.from(value),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    await result.body?.cancel();
    if (!result.ok) throw new Error('R2 rejected the upload');
  } catch {
    throw new Error(`Could not write preview narration ${type} asset`);
  }
}
