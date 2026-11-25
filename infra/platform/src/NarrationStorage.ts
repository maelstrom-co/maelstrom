import * as Cloudflare from '@alchemy.run/cloudflare';
import * as Alchemy from 'alchemy';
import { retain } from 'alchemy/RemovalPolicy';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';

import {
  narrationAccounts,
  narrationStorage,
  narrationProfile,
  previewCors,
  previewLifecycle,
  requireNarrationTarget,
  type NarrationStorageKind,
} from './NarrationStorageContract.js';

export const narrationStorageState = () =>
  Cloudflare.state({ accountId: narrationAccounts().production });

export const narrationBucketProps = (kind: NarrationStorageKind) =>
  ({
    name: narrationStorage[kind].bucket,
    publicAccess: narrationStorage[kind].public,
    domains: [],
    forceDestroy: false,
    exclusiveCreate: true,
    cors: kind === 'delivery' ? [previewCors] : [],
    lifecycleRules: kind === 'delivery' ? [previewLifecycle] : [],
  }) satisfies Cloudflare.R2.BucketProps;

export const makeNarrationStack = (kind: NarrationStorageKind) => {
  const target = narrationStorage[kind];
  return Alchemy.Stack(
    target.stack,
    { providers: Cloudflare.providers(), state: narrationStorageState() },
    Effect.gen(function* () {
      const { stage } = yield* Alchemy.Stack;
      const expected = requireNarrationTarget(kind, stage);
      const profile = yield* Config.String('ALCHEMY_PROFILE');
      const active = yield* yield* Cloudflare.CloudflareEnvironment;
      if (
        profile !== narrationProfile ||
        active.accountId !== expected.accountId
      ) {
        throw new Error(
          'Alchemy resolved an unexpected narration profile or resource account',
        );
      }
      const bucket = yield* Cloudflare.R2.Bucket(
        target.fqn,
        narrationBucketProps(kind),
      ).pipe(retain(true));
      return {
        accountId: bucket.accountId,
        bucketName: bucket.bucketName,
        publicDomain: bucket.publicDomain,
      };
    }),
  );
};
