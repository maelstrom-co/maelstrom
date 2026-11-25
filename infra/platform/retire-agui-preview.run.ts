import * as Cloudflare from '@alchemy.run/cloudflare';
import { previewStateStoreOptions } from '@maelstrom-co/platform-infra';
import * as Alchemy from 'alchemy';
import * as Effect from 'effect/Effect';

export default Alchemy.Stack(
  'MaelstromAguiPreview',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(previewStateStoreOptions()),
  },
  Effect.succeed({}),
);
