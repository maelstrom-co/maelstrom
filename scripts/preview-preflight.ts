import { isWorkersDevSuffix } from './preview-worker-url.ts';

const REPOSITORY_VARIABLES =
  'Settings → Secrets and variables → Actions → Variables';
const PREVIEW_VARIABLES =
  'Settings → Environments → preview → Environment variables';
const PREVIEW_SECRETS =
  'Settings → Environments → preview → Environment secrets';

const SETTING_LOCATIONS = {
  PRODUCTION_ACCOUNT_ID: REPOSITORY_VARIABLES,
  PREVIEW_ACCOUNT_ID: REPOSITORY_VARIABLES,
  CLOUDFLARE_PREVIEW_ACCOUNT_ID: PREVIEW_SECRETS,
  CLOUDFLARE_PREVIEW_API_TOKEN: PREVIEW_SECRETS,
  CLOUDFLARE_PREVIEW_WORKERS_DEV_SUFFIX: PREVIEW_VARIABLES,
};

/** Returns actionable preview configuration errors without including setting values. */
export const validatePreviewConfiguration = (
  environment: Readonly<Record<string, string | undefined>>,
): string[] => {
  const errors: string[] = [];
  for (const [name, location] of Object.entries(SETTING_LOCATIONS)) {
    if (!environment[name]?.trim()) {
      errors.push(
        `Required Actions setting '${name}' is unset. Configure it under ${location}.`,
      );
    }
  }
  if (errors.length > 0) return errors;

  const suffix = environment.CLOUDFLARE_PREVIEW_WORKERS_DEV_SUFFIX ?? '';
  if (!isWorkersDevSuffix(suffix)) {
    errors.push(
      `'CLOUDFLARE_PREVIEW_WORKERS_DEV_SUFFIX' must be '<account-subdomain>.workers.dev'. Configure it under ${PREVIEW_VARIABLES}.`,
    );
  }
  // Equal variables would let one swapped secret pass both account guards.
  if (environment.PRODUCTION_ACCOUNT_ID === environment.PREVIEW_ACCOUNT_ID) {
    errors.push(
      `'PRODUCTION_ACCOUNT_ID' and 'PREVIEW_ACCOUNT_ID' must be different. Configure them under ${REPOSITORY_VARIABLES}.`,
    );
  }
  return errors;
};

if (import.meta.main) {
  const errors = validatePreviewConfiguration(process.env);
  for (const error of errors) console.error(`::error::${error}`);
  process.exitCode = errors.length > 0 ? 1 : 0;
}
