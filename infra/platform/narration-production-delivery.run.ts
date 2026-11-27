import * as Cloudflare from '@alchemy.run/cloudflare';
import * as Alchemy from 'alchemy';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';

import { narrationDeliveryWorker } from './src/NarrationDelivery.js';
import { narrationDelivery } from './src/NarrationDeliveryContract.js';
import { narrationStorageState } from './src/NarrationStorage.js';
import {
  narrationProfile,
  requireNarrationTarget,
} from './src/NarrationStorageContract.js';

export default Alchemy.Stack(
  narrationDelivery.stack,
  { providers: Cloudflare.providers(), state: narrationStorageState() },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const target = requireNarrationTarget('cache', stage);
    const profile = yield* Config.String('ALCHEMY_PROFILE');
    const active = yield* yield* Cloudflare.CloudflareEnvironment;
    if (profile !== narrationProfile || active.accountId !== target.accountId) {
      throw new Error(
        'Alchemy resolved an unexpected narration delivery profile or resource account',
      );
    }
    const worker = yield* narrationDeliveryWorker;
    return { workerName: worker.workerName };
  }),
);
