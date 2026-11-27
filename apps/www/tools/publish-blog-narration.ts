import { S3Client } from 'bun';

import {
  type NarrationPublication,
  type NarrationStore,
} from './blog-narration-publication';

export function requiredNarrationSetting(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing narration configuration: ${name}`);
  return value;
}

const required = requiredNarrationSetting;

export function narrationR2Client(account: string, prefix: string) {
  if (!/^[a-f0-9]{32}$/u.test(account))
    throw new Error('Invalid narration R2 account ID');
  return new S3Client({
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    region: 'auto',
    bucket: required(`${prefix}_BUCKET`),
    accessKeyId: required(`${prefix}_ACCESS_KEY_ID`),
    secretAccessKey: required(`${prefix}_SECRET_ACCESS_KEY`),
  });
}

export function signedNarrationStore(client: S3Client): NarrationStore {
  async function readVersioned(key: string) {
    try {
      const result = await fetch(client.presign(key, { expiresIn: 60 }), {
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(30_000),
      });
      const value = await result.text();
      if (result.status === 404 && /<Code>NoSuchKey<\/Code>/u.test(value))
        return;
      const etag = result.headers.get('etag');
      if (!result.ok || !etag || !/^"[^"]+"$/u.test(etag)) {
        throw new Error('Versioned narration cache read failed');
      }
      return { value, etag };
    } catch {
      throw new Error('Versioned narration cache read failed');
    }
  }
  async function compareAndSet(
    key: string,
    value: string,
    etag: string | undefined,
  ) {
    try {
      const type = 'application/json';
      const headers = new Headers({ 'content-type': type });
      headers.set(
        etag === undefined ? 'if-none-match' : 'if-match',
        etag ?? '*',
      );
      const response = await fetch(
        client.presign(key, { method: 'PUT', expiresIn: 60, type }),
        {
          method: 'PUT',
          headers,
          body: value,
          redirect: 'error',
          credentials: 'omit',
          signal: AbortSignal.timeout(30_000),
        },
      );
      await response.body?.cancel();
      if (response.status === 412) return false;
      if (!response.ok)
        throw new Error('Conditional narration cache write failed');
      return true;
    } catch {
      throw new Error('Conditional narration cache write failed');
    }
  }
  return {
    readVersioned,
    compareAndSet,
    async get(key) {
      try {
        return await client.file(key).text();
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'NoSuchKey'
        )
          return;
        throw new Error('Narration cache read failed');
      }
    },
    async put(key, value) {
      try {
        const exists = !(await compareAndSet(key, value, undefined));
        if (exists && (await readVersioned(key))?.value !== value) {
          throw new Error('Narration cache contents changed');
        }
      } catch {
        throw new Error('Narration cache write failed');
      }
    },
  };
}

export function narrationCacheClient() {
  return narrationR2Client(
    required('BLOG_NARRATION_R2_ACCOUNT_ID'),
    'BLOG_NARRATION_R2',
  );
}

export function readNarrationConfig(): NarrationPublication {
  return {
    store: signedNarrationStore(narrationCacheClient()),
    voiceId: required('ELEVENLABS_MYVOICE_ID'),
    voiceRevision: required('ELEVENLABS_MYVOICE_REVISION'),
    apiKey: required('ELEVENLABS_API_KEY'),
  };
}
