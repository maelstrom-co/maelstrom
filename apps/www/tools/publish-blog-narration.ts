import { S3Client } from 'bun';

import {
  publishNarration,
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

function r2Store(): NarrationStore {
  const client = narrationR2Client(
    required('BLOG_NARRATION_R2_ACCOUNT_ID'),
    'BLOG_NARRATION_R2',
  );
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
        // The production-www concurrency group serializes trusted publishers.
        await client.write(key, value, { type: 'application/json' });
      } catch {
        throw new Error('Narration cache write failed');
      }
    },
  };
}

export function readNarrationConfig(): NarrationPublication {
  return {
    store: r2Store(),
    voiceId: required('ELEVENLABS_MYVOICE_ID'),
    voiceRevision: required('ELEVENLABS_MYVOICE_REVISION'),
    apiKey: required('ELEVENLABS_API_KEY'),
  };
}

if (import.meta.main) {
  await publishNarration(
    process.argv[2] ?? 'apps/www/dist/client',
    readNarrationConfig(),
  );
}
