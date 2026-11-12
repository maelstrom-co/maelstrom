import * as Cloudflare from '@alchemy.run/cloudflare';
import {
  previewStateStoreOptions,
  requirePreviewStage,
} from '@maelstrom-co/platform-infra';
import * as Alchemy from 'alchemy';
import * as Effect from 'effect/Effect';

import { PreviewWebsite } from './infra/PreviewWebsite.js';

export default Alchemy.Stack(
  'MaelstromDemoPreview',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(previewStateStoreOptions()),
  },
  Effect.gen(function* () {
    const stage = yield* requirePreviewStage('demo preview');
    const website = yield* PreviewWebsite(stage);
    return { url: website.url };
  }),
);
