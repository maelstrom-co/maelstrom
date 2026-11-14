import { expect, test } from 'bun:test';

import { OSS_PREVIEW_STATE_STORE_WORKER } from '../infra/platform/src/PreviewStateStoreContract.ts';
import { allowsPreviewRevalidationRequest } from './preview-state-revalidation.ts';

const account = 'a'.repeat(32);
const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;

test('revalidation permits only reads and the two existing-store authentication previews', () => {
  expect(
    allowsPreviewRevalidationRequest(`${api}/workers/scripts`, 'GET', account),
  ).toBe(true);
  for (const name of ['alchemy-state-store', OSS_PREVIEW_STATE_STORE_WORKER])
    expect(
      allowsPreviewRevalidationRequest(
        `${api}/workers/scripts/${name}/edge-preview`,
        'POST',
        account,
      ),
    ).toBe(true);
});

test.each([
  ['PUT', `${api}/workers/scripts/${OSS_PREVIEW_STATE_STORE_WORKER}`],
  [
    'POST',
    `${api}/workers/scripts/${OSS_PREVIEW_STATE_STORE_WORKER}/subdomain`,
  ],
  ['POST', `${api}/secrets_store/stores/one/secrets`],
  [
    'DELETE',
    `https://${OSS_PREVIEW_STATE_STORE_WORKER}.fixture.workers.dev/state/stacks/CloudflareStateStore`,
  ],
  [
    'PUT',
    `https://${OSS_PREVIEW_STATE_STORE_WORKER}.fixture.workers.dev/state/stacks/MaelstromDemoPreview/stages/pr-42/output`,
  ],
  ['POST', `${api}/workers/scripts/foreign/edge-preview`],
  [
    'POST',
    `${api}/workers/scripts/alchemy-state-store/edge-preview?mutate=true`,
  ],
  [
    'POST',
    `${api.replace(account, 'b'.repeat(32))}/workers/scripts/alchemy-state-store/edge-preview`,
  ],
])(
  'revalidation refuses %s %s even if the normal copy transport permits it',
  (method, url) => {
    expect(allowsPreviewRevalidationRequest(url, method, account)).toBe(false);
  },
);
