import { resolve } from 'node:path';
import * as Alchemy from 'alchemy';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Cloudflare from 'alchemy/Cloudflare';
import { retain } from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import {
  isProductionStage,
  isStateInspectionStage,
  production,
} from './src/production.js';

const toolRoot = import.meta.dirname;

export default Alchemy.Stack(
  'MaelstromPlatform',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stack = yield* Alchemy.Stack;

    if (isStateInspectionStage(stack.stage)) return {};

    if (!isProductionStage(stack.stage)) {
      return yield* Effect.die(
        new Error(
          `The platform stack only supports --stage ${production.stage}; received ${stack.stage}`,
        ),
      );
    }

    const waitlist = yield* Cloudflare.D1.Database('Waitlist', {
      name: production.waitlist.databaseName,
      migrationsDir: resolve(toolRoot, 'migrations'),
    }).pipe(retain(true));

    const sending = yield* Cloudflare.Email.SendingSubdomain(
      'NotificationsEmail',
      {
        zoneId: production.zone.id,
        name: production.waitlist.sendingDomain,
      },
    ).pipe(retain(true));

    const turnstile = yield* Cloudflare.Turnstile.Widget('WaitlistTurnstile', {
      name: production.waitlist.turnstile.name,
      domains: [...production.waitlist.turnstile.domains],
      mode: production.waitlist.turnstile.mode,
    }).pipe(adopt(true), retain(true));

    return {
      sendingDomain: sending.name,
      sendingEnabled: sending.enabled,
      turnstileSitekey: turnstile.sitekey,
      waitlistDatabaseId: waitlist.databaseId,
      waitlistDatabaseName: waitlist.databaseName,
    };
  }),
);
