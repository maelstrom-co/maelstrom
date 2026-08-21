import { resolve } from 'node:path';
import {
  WAITLIST_SENDER_ADDRESS,
  WAITLIST_TURNSTILE_SECRET_BINDING,
  WaitlistDatabase,
  WaitlistTurnstile,
  workerObservability,
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
      compatibility: {
        date: '2026-07-22',
        flags: ['nodejs_compat'],
      },
      env: {
        WAITLIST_DB: database,
        EMAIL: Cloudflare.Email.SendEmail('EMAIL', {
          allowedSenderAddresses: [WAITLIST_SENDER_ADDRESS],
        }),
        [WAITLIST_TURNSTILE_SECRET_BINDING]: turnstile.secret,
        IMAGES: Cloudflare.Images.Images('IMAGES'),
      },
      observability: {
        ...workerObservability,
        traces: {
          enabled: false,
          headSamplingRate: 1,
          persist: true,
        },
      },
    };
  }),
).pipe(retain(true));
