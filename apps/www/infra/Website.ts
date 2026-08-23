import { resolve } from 'node:path';
import {
  ASTRO_WORKER_FLAGS,
  WAITLIST_SENDER_ADDRESS,
  WAITLIST_TURNSTILE_SECRET_BINDING,
  WaitlistDatabase,
  WaitlistTurnstile,
  WORKER_COMPATIBILITY_DATE,
  workerObservabilityNoTraces,
} from '@maelstrom-co/platform-infra';
import * as Cloudflare from 'alchemy/Cloudflare';
import { retain } from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';

const appRoot = resolve(import.meta.dirname, '..');

export const Website = Cloudflare.Worker(
  'Website',
  Effect.gen(function* () {
    const database = yield* WaitlistDatabase;
    const turnstile = yield* WaitlistTurnstile;

    return {
      main: resolve(appRoot, 'dist/server/entry.mjs'),
      bundle: false,
      assets: { directory: resolve(appRoot, 'dist/client') },
      name: 'www',
      domain: {
        name: 'maelstrom-ai.co',
        aliases: ['www.maelstrom-ai.co'],
      },
      // Production serves only the custom domains; the default would also
      // publish a stable *.workers.dev URL plus version preview URLs outside
      // zone-scoped WAF and rate limiting.
      workersDev: false,
      compatibility: {
        date: WORKER_COMPATIBILITY_DATE,
        flags: ASTRO_WORKER_FLAGS,
      },
      env: {
        WAITLIST_DB: database,
        EMAIL: Cloudflare.Email.SendEmail('EMAIL', {
          allowedSenderAddresses: [WAITLIST_SENDER_ADDRESS],
        }),
        [WAITLIST_TURNSTILE_SECRET_BINDING]: turnstile.secret,
        IMAGES: Cloudflare.Images.Images('IMAGES'),
      },
      observability: workerObservabilityNoTraces,
    };
  }),
).pipe(retain(true));

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;
