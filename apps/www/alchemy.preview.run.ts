import { requirePreviewStage } from '@maelstrom-co/platform-infra';
import * as Alchemy from 'alchemy';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Effect from 'effect/Effect';
import { PreviewWebsite } from './infra/PreviewWebsite.js';

export default Alchemy.Stack(
  'MaelstromWwwPreview',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* requirePreviewStage('www preview');
    const website = yield* PreviewWebsite(stage);
    return { url: website.url };
  }),
);
