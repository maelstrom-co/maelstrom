import * as Cloudflare from '@alchemy.run/cloudflare';
import * as Alchemy from 'alchemy';
import * as Effect from 'effect/Effect';

import { inspectionStateStoreOptions } from './src/PreviewStateStore.js';

export default Alchemy.Stack(
  'MaelstromStateInspection',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(inspectionStateStoreOptions()),
  },
  Effect.succeed({}),
);
