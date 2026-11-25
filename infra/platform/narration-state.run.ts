import * as Cloudflare from '@alchemy.run/cloudflare';
import * as Alchemy from 'alchemy';
import * as Effect from 'effect/Effect';

import { narrationStorageState } from './src/NarrationStorage.js';

export default Alchemy.Stack(
  'MaelstromNarrationStateInspection',
  { providers: Cloudflare.providers(), state: narrationStorageState() },
  Effect.succeed({}),
);
