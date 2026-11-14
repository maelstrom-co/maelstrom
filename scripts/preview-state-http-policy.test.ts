import { expect, test } from 'bun:test';

import { OSS_PREVIEW_STATE_STORE_WORKER } from '../infra/platform/src/PreviewStateStoreContract.ts';
import { allowsPreviewStateRequest } from './preview-state-http-policy.ts';

const accountId = 'a'.repeat(32);
const policy = {
  accountId,
  destinationScopes: new Set(['MaelstromDemoPreview/pr-42']),
  workersDevSuffix: 'preview.workers.dev',
  exchangeUrls: new Set(['https://exchange.cloudflare.com/session']),
};
const source = 'https://alchemy-state-store.preview.workers.dev';
const target = `https://${OSS_PREVIEW_STATE_STORE_WORKER}.preview.workers.dev`;
const api = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const path =
  '/state/stacks/MaelstromDemoPreview/stages/pr-42/resources/Folder%252FWebsite';

test('the source can be read but never receive state writes or legacy-management deletion', () => {
  expect(
    allowsPreviewStateRequest({ method: 'GET', url: source + path }, policy),
  ).toBeTrue();
  for (const method of ['PUT', 'POST', 'DELETE', 'PATCH']) {
    expect(
      allowsPreviewStateRequest({ method, url: source + path }, policy),
    ).toBeFalse();
    expect(
      allowsPreviewStateRequest(
        { method, url: source + '/state/stacks/CloudflareStateStore' },
        policy,
      ),
    ).toBeFalse();
  }
});

test('only selected destination namespaces can receive rows or stack outputs', () => {
  expect(
    allowsPreviewStateRequest({ method: 'PUT', url: target + path }, policy),
  ).toBeTrue();
  expect(
    allowsPreviewStateRequest(
      {
        method: 'PUT',
        url: target + '/state/stacks/MaelstromDemoPreview/stages/pr-42/output',
      },
      policy,
    ),
  ).toBeTrue();
  for (const uri of [
    path.replace('MaelstromDemoPreview', 'MaelstromCloudFoundation'),
    path.replace('pr-42', 'prod'),
    path.replace('pr-42', 'pr-9999'),
    path + '/extra',
  ]) {
    expect(
      allowsPreviewStateRequest({ method: 'PUT', url: target + uri }, policy),
    ).toBeFalse();
  }
  expect(
    allowsPreviewStateRequest({ method: 'DELETE', url: target + path }, policy),
  ).toBeFalse();
  expect(
    allowsPreviewStateRequest(
      { method: 'DELETE', url: target + '/state/stacks/CloudflareStateStore' },
      policy,
    ),
  ).toBeTrue();
});

test('token discovery permits temporary source previews but never a default production-script upload', () => {
  expect(
    allowsPreviewStateRequest(
      {
        method: 'POST',
        url: api + '/workers/scripts/alchemy-state-store/edge-preview',
      },
      policy,
    ),
  ).toBeTrue();
  expect(
    allowsPreviewStateRequest(
      { method: 'PUT', url: api + '/workers/scripts/alchemy-state-store' },
      policy,
    ),
  ).toBeFalse();
  expect(
    allowsPreviewStateRequest(
      {
        method: 'POST',
        url: api + '/workers/scripts/alchemy-state-store/subdomain',
      },
      policy,
    ),
  ).toBeFalse();
  expect(
    allowsPreviewStateRequest(
      {
        method: 'PUT',
        url: api + `/workers/scripts/${OSS_PREVIEW_STATE_STORE_WORKER}`,
      },
      policy,
    ),
  ).toBeTrue();
  expect(
    allowsPreviewStateRequest(
      { method: 'PUT', url: api + '/workers/scripts/other-project' },
      policy,
    ),
  ).toBeFalse();
});

test('only new named secrets can be created; source secrets cannot be replaced or deleted', () => {
  const name = `AlchemyStateStoreToken_${OSS_PREVIEW_STATE_STORE_WORKER.replaceAll('-', '_')}`;
  const body = [
    { name, value: 'b'.repeat(64), scopes: ['workers'], comment: 'test' },
  ];
  const url = api + '/secrets_store/stores/store-id/secrets';
  expect(
    allowsPreviewStateRequest({ method: 'POST', url, jsonBody: body }, policy),
  ).toBeTrue();
  expect(
    allowsPreviewStateRequest(
      {
        method: 'POST',
        url,
        jsonBody: [{ ...body[0], name: 'AlchemyStateStoreToken' }],
      },
      policy,
    ),
  ).toBeFalse();
  expect(
    allowsPreviewStateRequest(
      {
        method: 'POST',
        url,
        jsonBody: [{ ...body[0], secret_id: 'original-secret' }],
      },
      policy,
    ),
  ).toBeFalse();
  for (const method of ['PUT', 'PATCH', 'DELETE', 'POST'])
    expect(
      allowsPreviewStateRequest(
        { method, url: url + '/original-secret' },
        policy,
      ),
    ).toBeFalse();
});

test('another account, insecure origin or unapproved exchange cannot receive credentials', () => {
  for (const url of [
    api.replace(accountId, 'c'.repeat(32)),
    'http://alchemy-state-store.preview.workers.dev/version',
    'https://attacker.invalid/version',
    'https://user:pass@alchemy-state-store.preview.workers.dev/version',
  ]) {
    expect(
      allowsPreviewStateRequest({ method: 'GET', url }, policy),
    ).toBeFalse();
  }
  expect(
    allowsPreviewStateRequest(
      { method: 'GET', url: 'https://exchange.cloudflare.com/session' },
      policy,
    ),
  ).toBeTrue();
  expect(
    allowsPreviewStateRequest(
      { method: 'POST', url: 'https://exchange.cloudflare.com/session' },
      policy,
    ),
  ).toBeFalse();
  expect(
    allowsPreviewStateRequest(
      { method: 'GET', url: 'https://exchange.cloudflare.com/other' },
      policy,
    ),
  ).toBeFalse();
});
