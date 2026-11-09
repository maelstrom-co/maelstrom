/// <reference types="@cloudflare/workers-types" />

import type { WebsiteEnv } from '../../infra/Website';

declare global {
  interface Env extends WebsiteEnv {}
}
