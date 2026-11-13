import { OSS_PREVIEW_STATE_STORE_WORKER } from './PreviewStateStoreContract.js';

/** Pins every OSS preview caller to the verified isolated backend and account. */
export function previewStateStoreOptions(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (env.ALCHEMY_PREVIEW_STATE_STORE_WORKER !== OSS_PREVIEW_STATE_STORE_WORKER)
    throw new Error('OSS previews require the isolated state-store pointer');
  const accountId = env.EXPECTED_CLOUDFLARE_ACCOUNT_ID;
  if (!accountId || !/^[0-9a-f]{32}$/.test(accountId))
    throw new Error('OSS previews require an exact expected account ID');
  return { workerName: OSS_PREVIEW_STATE_STORE_WORKER, accountId };
}

/** Selects the named backend for preview inspection while preserving production's default. */
export function inspectionStateStoreOptions(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return env.ALCHEMY_PREVIEW_STATE_STORE_WORKER
    ? previewStateStoreOptions(env)
    : {};
}
