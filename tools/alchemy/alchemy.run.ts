import { resolve } from 'node:path';
import * as Alchemy from 'alchemy';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Cloudflare from 'alchemy/Cloudflare';
import { retain } from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import {
  isProductionStage,
  isStateInspectionStage,
  production,
} from './src/production.js';

const toolRoot = import.meta.dirname;

const observability = {
  enabled: true,
  headSamplingRate: 1,
  logs: {
    enabled: true,
    headSamplingRate: 1,
    invocationLogs: true,
    persist: true,
  },
} as const;

export default Alchemy.Stack(
  'MaelstromCloudflare',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stack = yield* Alchemy.Stack;
    const isProduction = isProductionStage(stack.stage);

    if (isStateInspectionStage(stack.stage)) return {};

    if (!isProduction) {
      return yield* Effect.die(
        new Error(
          `The adoption stack only supports --stage ${production.stage}; received ${stack.stage}`,
        ),
      );
    }

    const zone = yield* Cloudflare.Zone.Zone('Zone', {
      ...production.zone,
      vanityNameServers: [...production.zone.vanityNameServers],
    }).pipe(adopt(true), retain(true));

    const dnssec = yield* Cloudflare.DNS.Dnssec('Dnssec', {
      zoneId: zone.zoneId,
      status: 'active',
    }).pipe(adopt(true), retain(true));

    const waitlist = yield* Cloudflare.D1.Database.ref('Waitlist', {
      stack: 'MaelstromPlatform',
      stage: production.stage,
    });
    const waitlistTurnstile = yield* Cloudflare.Turnstile.Widget.ref(
      'WaitlistTurnstile',
      {
        stack: 'MaelstromPlatform',
        stage: production.stage,
      },
    );

    const www = yield* Cloudflare.Worker('Www', {
      main: resolve(toolRoot, production.www.main),
      bundle: production.www.bundle,
      assets: {
        directory: resolve(toolRoot, production.www.assets),
      },
      name: production.www.workerName,
      domain: {
        name: production.www.domains[0],
        aliases: [production.www.domains[1]],
      },
      compatibility: {
        date: production.www.compatibilityDate,
        flags: [...production.www.compatibilityFlags],
      },
      env: {
        [production.www.bindings.database]: waitlist,
        [production.www.bindings.email]: Cloudflare.Email.SendEmail('EMAIL', {
          allowedSenderAddresses: [production.www.senderAddress],
        }),
        [production.www.bindings.turnstileSecret]: waitlistTurnstile.secret,
        [production.www.bindings.images]: Cloudflare.Images.Images(
          production.www.bindings.images,
        ),
      },
      observability: {
        ...observability,
        traces: {
          enabled: false,
          headSamplingRate: 1,
          persist: true,
        },
      },
    }).pipe(adopt(true), retain(true));

    const docs = yield* Cloudflare.Worker('Docs', {
      assets: {
        directory: resolve(toolRoot, production.docs.assets),
      },
      name: production.docs.workerName,
      domain: production.docs.domains[0],
      compatibility: { date: production.docs.compatibilityDate },
      observability,
    }).pipe(adopt(true), retain(true));

    const demo = yield* Cloudflare.Worker('Demo', {
      main: resolve(toolRoot, production.demo.main),
      name: production.demo.workerName,
      domain: production.demo.domains[0],
      compatibility: { date: production.demo.compatibilityDate },
      assets: {
        directory: resolve(toolRoot, production.demo.assets),
        notFoundHandling: production.demo.notFoundHandling,
        runWorkerFirst: [...production.demo.runWorkerFirst],
      },
      env: {
        // Adoption matches this binding and class to the existing SQLite v1
        // namespace. Alchemy emits SQLite migrations only for a new class.
        [production.demo.durableObject.binding]: Cloudflare.DurableObject(
          production.demo.durableObject.binding,
          {
            className: production.demo.durableObject.className,
          },
        ),
      },
      observability,
    }).pipe(adopt(true), retain(true));

    return {
      dnssecDs: dnssec?.ds,
      docsUrl: docs.url,
      demoUrl: demo.url,
      wwwUrl: www.url,
    };
  }),
);
