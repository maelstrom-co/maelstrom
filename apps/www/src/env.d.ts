/// <reference types="@cloudflare/workers-types" />

import type { WebsiteEnv } from '../infra/Website.js';
import type { PreviewWebsiteEnv } from '../infra/PreviewWebsite.js';

export type RuntimeWebsiteEnv = PreviewWebsiteEnv &
  Partial<Omit<WebsiteEnv, keyof PreviewWebsiteEnv>>;

type IsRequired<T, K extends keyof T> =
  Record<never, never> extends Pick<T, K> ? false : true;
type IsOptional<T, K extends keyof T> =
  IsRequired<T, K> extends true ? false : true;
type Assert<T extends true> = T;

export type RuntimeWebsiteEnvContract = [
  Assert<IsRequired<RuntimeWebsiteEnv, 'ASSETS'>>,
  Assert<IsRequired<RuntimeWebsiteEnv, 'IMAGES'>>,
  Assert<IsOptional<RuntimeWebsiteEnv, 'WAITLIST_DB'>>,
  Assert<IsOptional<RuntimeWebsiteEnv, 'EMAIL'>>,
  Assert<IsOptional<RuntimeWebsiteEnv, 'TURNSTILE_SECRET_KEY'>>,
];

declare global {
  interface Env extends RuntimeWebsiteEnv {}

  namespace Cloudflare {
    interface Env extends RuntimeWebsiteEnv {}
  }
}
