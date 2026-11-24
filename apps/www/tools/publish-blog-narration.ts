import { S3Client } from 'bun';

import {
  publishNarration,
  type NarrationStore,
} from './blog-narration-publication';

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing narration configuration: ${name}`);
  return value;
}

function r2Store(): NarrationStore {
  const account = required('BLOG_NARRATION_R2_ACCOUNT_ID');
  if (!/^[a-f0-9]{32}$/u.test(account))
    throw new Error('Invalid narration R2 account ID');
  const client = new S3Client({
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    region: 'auto',
    bucket: required('BLOG_NARRATION_R2_BUCKET'),
    accessKeyId: required('BLOG_NARRATION_R2_ACCESS_KEY_ID'),
    secretAccessKey: required('BLOG_NARRATION_R2_SECRET_ACCESS_KEY'),
  });
  return {
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
        // The production www deployment concurrency group serializes cache writers.
        await client.write(key, value, { type: 'application/json' });
      } catch {
        throw new Error('Narration cache write failed');
      }
    },
  };
}

if (import.meta.main) {
  await publishNarration(process.argv[2] ?? 'apps/www/dist/client', {
    store: r2Store(),
    voiceId: required('ELEVENLABS_MYVOICE_ID'),
    voiceRevision: required('ELEVENLABS_MYVOICE_REVISION'),
    apiKey: required('ELEVENLABS_API_KEY'),
  });
}
