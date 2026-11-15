import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { OSS_PREVIEW_STATE_STORE_WORKER } from '../infra/platform/src/PreviewStateStoreContract.ts';
import type { IsolationCopyReceipt } from './preview-state-isolation-receipt.ts';

/** Adds a mutation ban to the isolation client's existing origin and path restrictions. */
export function allowsPreviewRevalidationRequest(
  urlValue: string,
  method: string,
  accountId: string,
) {
  if (method === 'GET' || method === 'HEAD') return true;
  const url = new URL(urlValue);
  return (
    method === 'POST' &&
    url.origin === 'https://api.cloudflare.com' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    ['alchemy-state-store', OSS_PREVIEW_STATE_STORE_WORKER].some(
      (worker) =>
        url.pathname ===
        `/client/v4/accounts/${accountId}/workers/scripts/${worker}/edge-preview`,
    )
  );
}

/** Generates a read-only comparison program using the reviewed candidate's guarded SDK runtime. */
export function previewRevalidationSource(
  control: string,
  origin: IsolationCopyReceipt,
  pullNumbers: readonly string[],
  workersDevSuffix: string,
) {
  const module = (name: string) =>
    JSON.stringify(pathToFileURL(join(control, 'scripts', name)).href);
  return `
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import * as Option from 'effect/Option';
import { makePreviewIsolationRuntime, previewWireReader, isolationWorkerNames } from './preview-state-isolation.ts';
import { comparePreviewCopy } from ${module('preview-state-copy.ts')};
import { allowsPreviewRevalidationRequest } from ${module('preview-state-revalidation.ts')};
const config = {
  accountId: ${JSON.stringify(origin.accountId)},
  apiToken: process.env.CLOUDFLARE_API_TOKEN,
  workersDevSuffix: ${JSON.stringify(workersDevSuffix)},
};
const base = await Effect.runPromise(Effect.provide(HttpClient.HttpClient, FetchHttpClient.layer));
const readOnly = HttpClient.transform(base, (send, request) => {
  const url = Option.getOrUndefined(HttpClientRequest.toUrl(request));
  return url && allowsPreviewRevalidationRequest(url.href, request.method, config.accountId)
    ? send : Effect.die(new Error('PREVIEW_REVALIDATION_MUTATION_REJECTED'));
});
const runtime = makePreviewIsolationRuntime(config, readOnly);
try {
  const workerNames = await isolationWorkerNames(runtime, config.accountId);
  if (workerNames.some((name) => name.startsWith('maelstrom-state-canary-')))
    throw new Error('PREVIEW_CANARY_REPAIR_REQUIRED');
  if (!workerNames.includes(${JSON.stringify(OSS_PREVIEW_STATE_STORE_WORKER)}))
    throw new Error('PREVIEW_COPY_DESTINATION_MISSING');
  const source = await previewWireReader(runtime, config, 'alchemy-state-store');
  const target = await previewWireReader(runtime, config, ${JSON.stringify(OSS_PREVIEW_STATE_STORE_WORKER)});
  const proof = await comparePreviewCopy(source, target, {
    pullNumbers: ${JSON.stringify(pullNumbers)}, workerNames,
  }, ${JSON.stringify(origin)}, async () => {});
  console.log(JSON.stringify({ verified: true, ...proof }));
} finally {
  await runtime.dispose();
}
`;
}
