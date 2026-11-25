import { resolve } from 'node:path';

import * as Cloudflare from '@alchemy.run/cloudflare';
import { retain } from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';

import {
  narrationDelivery,
  narrationDeliveryRoutes,
} from './NarrationDeliveryContract.js';
import { narrationStorage } from './NarrationStorageContract.js';
import { workerObservabilityNoTraces } from './Observability.js';

const cache = narrationStorage.cache;
const cacheBucket = Cloudflare.R2.Bucket.ref(cache.fqn, {
  stack: cache.stack,
  stage: cache.stage,
});

export const narrationDeliveryWorker = Cloudflare.Worker(
  narrationDelivery.fqn,
  Effect.gen(function* () {
    const bucket = yield* cacheBucket;
    return {
      name: narrationDelivery.name,
      main: resolve(import.meta.dirname, 'narration-delivery-worker.ts'),
      routes: narrationDeliveryRoutes,
      workersDev: false,
      compatibility: { date: '2026-11-25' },
      env: { NARRATION_BUCKET: bucket },
      observability: workerObservabilityNoTraces,
    };
  }),
).pipe(retain(true));

export type NarrationDeliveryEnv = Cloudflare.InferEnv<
  typeof narrationDeliveryWorker
>;
