import * as Cloudflare from 'alchemy/Cloudflare';
import * as Effect from 'effect/Effect';
import { MaelstromPlatform } from './src/Stack.js';
import { requireProductionStage } from './src/Stage.js';
import { WaitlistPlatform } from './src/Waitlist.js';

export default MaelstromPlatform.make(
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    yield* requireProductionStage('platform');
    const { sending, turnstile, waitlist } = yield* WaitlistPlatform;

    return {
      sendingDomain: sending.name.as<string>(),
      sendingEnabled: sending.enabled,
      turnstileSitekey: turnstile.sitekey.as<string>(),
      waitlistDatabaseId: waitlist.databaseId.as<string>(),
      waitlistDatabaseName: waitlist.databaseName.as<string>(),
    };
  }),
);
