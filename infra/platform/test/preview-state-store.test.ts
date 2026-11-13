import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import {
  previewStateStoreOptions,
  inspectionStateStoreOptions,
} from '../src/PreviewStateStore.js';
import { OSS_PREVIEW_STATE_STORE_WORKER } from '../src/PreviewStateStoreContract.js';

const env = {
  ALCHEMY_PREVIEW_STATE_STORE_WORKER: OSS_PREVIEW_STATE_STORE_WORKER,
  EXPECTED_CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
};
test('preview callers cannot fall back to the shared Cloud backend or an inferred account', () => {
  expect(previewStateStoreOptions(env)).toEqual({
    workerName: OSS_PREVIEW_STATE_STORE_WORKER,
    accountId: 'a'.repeat(32),
  });
  for (const change of [
    { ALCHEMY_PREVIEW_STATE_STORE_WORKER: undefined },
    { ALCHEMY_PREVIEW_STATE_STORE_WORKER: 'alchemy-state-store' },
    { EXPECTED_CLOUDFLARE_ACCOUNT_ID: undefined },
  ])
    expect(() => previewStateStoreOptions({ ...env, ...change })).toThrow();
  expect(inspectionStateStoreOptions({})).toEqual({});
  expect(inspectionStateStoreOptions(env)).toEqual(
    previewStateStoreOptions(env),
  );
});
test('the advertised capability routes all three preview entrypoints and the maintenance reader', async () => {
  const root = import.meta.dir + '/../../..';
  const pkg = JSON.parse(await readFile(root + '/package.json', 'utf8'));
  expect(pkg.maelstromPreviewStateStore).toBe(OSS_PREVIEW_STATE_STORE_WORKER);
  for (const app of ['www', 'docs', 'demo'])
    expect(
      await readFile(`${root}/apps/${app}/alchemy.preview.run.ts`, 'utf8'),
    ).toContain('Cloudflare.state(previewStateStoreOptions())');
  expect(
    await readFile(root + '/infra/platform/state.run.ts', 'utf8'),
  ).toContain('Cloudflare.state(inspectionStateStoreOptions())');
});
