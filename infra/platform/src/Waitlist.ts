import { resolve } from 'node:path';
import * as Cloudflare from 'alchemy/Cloudflare';
import { retain } from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { PRODUCTION_STAGE } from './Stage.js';
import {
  WAITLIST_PRODUCTION_HOSTNAMES,
  WAITLIST_SENDING_DOMAIN,
} from './WaitlistContract.js';

/** Stable name of the retained waitlist D1. */
export const WAITLIST_DATABASE_NAME = 'maelstrom-waitlist-v2';
/** Worker binding that receives the managed Turnstile secret. */
export const WAITLIST_TURNSTILE_SECRET_BINDING = 'TURNSTILE_SECRET_KEY';

/**
 * Retained production resources shared by independently deployed
 * applications.
 *
 * @param zone — managed production zone that owns the sending subdomain.
 */
export const WaitlistPlatform = (zone: Cloudflare.Zone.Zone) =>
  Effect.gen(function* () {
    const waitlist = yield* Cloudflare.D1.Database('WaitlistNext', {
      name: WAITLIST_DATABASE_NAME,
      migrations: resolve(import.meta.dirname, '../drizzle/migrations'),
    }).pipe(retain(true));

    const sending = yield* Cloudflare.Email.SendingSubdomain(
      'NotificationsEmail',
      {
        zoneId: zone.zoneId,
        name: WAITLIST_SENDING_DOMAIN,
      },
    ).pipe(retain(true));

    const turnstile = yield* Cloudflare.Turnstile.Widget('WaitlistTurnstile', {
      name: 'Maelstrom waitlist',
      domains: [...WAITLIST_PRODUCTION_HOSTNAMES],
      mode: 'managed',
    }).pipe(retain(true));

    return { sending, turnstile, waitlist };
  });

/** Production D1 reference that never transfers database ownership. */
export const WaitlistDatabase = Cloudflare.D1.Database.ref('WaitlistNext', {
  stack: 'MaelstromPlatform',
  stage: PRODUCTION_STAGE,
});

/** Production Turnstile reference that never transfers widget ownership. */
export const WaitlistTurnstile = Cloudflare.Turnstile.Widget.ref(
  'WaitlistTurnstile',
  {
    stack: 'MaelstromPlatform',
    stage: PRODUCTION_STAGE,
  },
);
