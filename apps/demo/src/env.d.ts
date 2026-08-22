/// <reference types="@cloudflare/workers-types" />

import type { WebsiteEnv } from '../infra/Website.js';

declare global {
  interface Env extends WebsiteEnv {}
}
