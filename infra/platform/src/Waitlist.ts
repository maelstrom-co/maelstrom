import { resolve } from 'node:path';
import * as Cloudflare from 'alchemy/Cloudflare';
import { retain } from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { PRODUCTION_STAGE } from './Stage.js';

export const WAITLIST_DATABASE_NAME = 'maelstrom-waitlist';
export const WAITLIST_SENDING_DOMAIN = 'notifications.maelstrom-ai.co';
export const WAITLIST_SENDER_ADDRESS = 'waitlist@notifications.maelstrom-ai.co';
export const WAITLIST_TURNSTILE_SITE_KEY = '0x4AAAAAAEXK9DFwilhX3Cla';
export const WAITLIST_TURNSTILE_ACTION = 'turnstile-spin-v1';
export const WAITLIST_TURNSTILE_SECRET_BINDING = 'TURNSTILE_SECRET_KEY';

const PRODUCTION_ZONE_ID = '4df25ea08d364f19471be7a179ce9f02';

export const WaitlistPlatform = Effect.gen(function* () {
  const waitlist = yield* Cloudflare.D1.Database('Waitlist', {
    name: WAITLIST_DATABASE_NAME,
    migrations: resolve(import.meta.dirname, '../migrations'),
  }).pipe(retain(true));

  const sending = yield* Cloudflare.Email.SendingSubdomain(
    'NotificationsEmail',
    {
      zoneId: PRODUCTION_ZONE_ID,
      name: WAITLIST_SENDING_DOMAIN,
    },
  ).pipe(retain(true));

  const turnstile = yield* Cloudflare.Turnstile.Widget('WaitlistTurnstile', {
    name: 'Maelstrom waitlist',
    domains: [
      'maelstrom-ai.co',
      'www.maelstrom-ai.co',
      'localhost',
      '127.0.0.1',
    ],
    mode: 'managed',
  }).pipe(retain(true));

  return { sending, turnstile, waitlist };
});

export const WaitlistDatabase = Cloudflare.D1.Database.ref('Waitlist', {
  stack: 'MaelstromPlatform',
  stage: PRODUCTION_STAGE,
});

export const WaitlistTurnstile = Cloudflare.Turnstile.Widget.ref(
  'WaitlistTurnstile',
  {
    stack: 'MaelstromPlatform',
    stage: PRODUCTION_STAGE,
  },
);
