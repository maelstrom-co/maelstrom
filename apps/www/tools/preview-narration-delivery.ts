import type { S3Client } from 'bun';

type AssetClient = Pick<S3Client, 'presign'>;

export function putPreviewNarrationAsset(
  client: AssetClient,
  path: string,
  value: string | Uint8Array,
  type: string,
) {
  return putAsset(client, path, value, type, false);
}

export function putImmutableNarrationAsset(
  client: AssetClient,
  path: string,
  value: string | Uint8Array,
  type: string,
) {
  return putAsset(client, path, value, type, true);
}

async function putAsset(
  client: AssetClient,
  path: string,
  value: string | Uint8Array,
  type: string,
  immutable: boolean,
) {
  const cacheControl =
    type === 'audio/wav' ? 'public, max-age=86400, immutable' : 'no-store';
  const requestOptions = {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  } as const;
  const expected =
    typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
  try {
    const url = client.presign(path, { method: 'PUT', expiresIn: 60, type });
    const result = await fetch(url, {
      method: 'PUT',
      headers: {
        'content-type': type,
        'cache-control': cacheControl,
        ...(immutable ? { 'if-none-match': '*' } : {}),
      },
      body: expected,
      ...requestOptions,
    });
    await result.body?.cancel();
    if (immutable && result.status === 412) {
      const existing = await fetch(
        client.presign(path, { expiresIn: 60 }),
        requestOptions,
      );
      if (
        existing.ok &&
        Buffer.from(await existing.arrayBuffer()).equals(expected)
      )
        return;
      await existing.body?.cancel();
    }
    if (!result.ok) throw new Error('R2 rejected the upload');
  } catch {
    throw new Error(`Could not write narration ${type} asset`);
  }
}
