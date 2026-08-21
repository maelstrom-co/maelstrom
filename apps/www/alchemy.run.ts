import { requireProductionStage } from '@maelstrom-co/platform-infra';
import * as Alchemy from 'alchemy';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Effect from 'effect/Effect';
import { Website } from './infra/Website.js';

export default Alchemy.Stack(
  'MaelstromWww',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    yield* requireProductionStage('www');
    const website = yield* Website;
    return { url: website.url };
  }),
);
