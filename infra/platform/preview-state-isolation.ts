import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Access } from '@alchemy.run/cloudflare/Access';
import { CloudflareEnvironment } from '@alchemy.run/cloudflare/CloudflareEnvironment';
import {
  bootstrap,
  loginWithCloudflare,
} from '@alchemy.run/cloudflare/StateStore/State';
import {
  apiTokenCredentials,
  Credentials,
} from '@distilled.cloud/cloudflare/Credentials';
import * as workers from '@distilled.cloud/cloudflare/workers';
import * as Alchemist from 'alchemy/Alchemist';
import * as Interaction from 'alchemy/Interaction';
import { StateApi } from 'alchemy/State/HttpStateApi';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as HttpApiClient from 'effect/http-api/HttpApiClient';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import * as HttpClientResponse from 'effect/http/HttpClientResponse';
import * as Layer from 'effect/Layer';
import * as Logger from 'effect/Logger';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import * as Option from 'effect/Option';
import * as Redacted from 'effect/Redacted';
import * as Stream from 'effect/Stream';

import {
  copyPreviewState,
  previewWireValue,
  snapshotPreviewState,
  type PreviewStateDestination,
  type PreviewStateReader,
} from '../../scripts/preview-state-copy.ts';
import { allowsPreviewStateRequest } from '../../scripts/preview-state-http-policy.ts';
import {
  assertIsolationAuthority,
  assertIsolationSource,
  isolationGithubRequest,
  isolationPullNumbers,
  previewIsolationContext,
} from '../../scripts/preview-state-isolation.ts';
import { OSS_PREVIEW_STATE_STORE_WORKER } from './src/PreviewStateStoreContract.js';

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Credentials and exact endpoints for the preview-only transport. */
export interface PreviewIsolationClientConfig {
  /** Operator-pinned preview account, never inferred from a cached profile. */
  readonly accountId: string;
  /** In-memory API token; never serialized or included in errors. */
  readonly apiToken: string;
  /** Operator-verified account subdomain, including workers.dev. */
  readonly workersDevSuffix: string;
}

function quietInteraction(): Interaction.Interaction['Service'] {
  const base = Interaction.makeNonInteractive({
    stdout: process.stderr,
    colors: false,
    unicode: false,
  });
  return {
    ...base,
    output: {
      print: () => Effect.void,
      info: () => Effect.void,
      success: () => Effect.void,
      warning: () => Effect.void,
      error: () => Effect.void,
    },
    live: () => Effect.succeed({ close: Effect.void }),
    progress: () =>
      Effect.succeed({
        update: () => Effect.void,
        succeed: () => Effect.void,
        fail: () => Effect.void,
        close: Effect.void,
      }),
    task: (_options, effect) => effect,
    browserLogin: () =>
      Effect.fail(
        new Interaction.NonInteractiveTerminal({
          operation: 'browser login',
          message: 'ISOLATION_INTERACTIVE_AUTH_REJECTED',
        }),
      ),
  };
}

/** Builds a guarded runtime without state factories, AccessLive, or application entrypoints. */
export function makePreviewIsolationRuntime(
  config: PreviewIsolationClientConfig,
  testClient?: HttpClient.HttpClient,
) {
  const exchangeUrls = new Set<string>();
  const destinationScopes = new Set<string>();
  const policy = { ...config, exchangeUrls, destinationScopes };
  const foundation = Alchemist.layer();
  const guarded = Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (base) =>
      HttpClient.transform(testClient ?? base, (send, request) =>
        Effect.gen(function* () {
          const location = Option.getOrUndefined(
            HttpClientRequest.toUrl(request),
          );
          if (!location)
            return yield* Effect.die(
              new Error('ISOLATION_HTTP_GUARD_REJECTED'),
            );
          let jsonBody: unknown;
          if (
            request.method === 'POST' &&
            /\/secrets_store\/stores\/[^/]+\/secrets$/.test(
              location.pathname,
            ) &&
            request.body._tag === 'Uint8Array'
          ) {
            try {
              jsonBody = JSON.parse(
                new TextDecoder().decode(request.body.body),
              );
            } catch {
              return yield* Effect.die(
                new Error('ISOLATION_HTTP_GUARD_REJECTED'),
              );
            }
          }
          if (
            !allowsPreviewStateRequest(
              { url: location.href, method: request.method, jsonBody },
              policy,
            )
          )
            return yield* Effect.die(
              new Error('ISOLATION_HTTP_GUARD_REJECTED'),
            );
          const response = yield* send;
          if (
            request.method === 'GET' &&
            location.origin === 'https://api.cloudflare.com' &&
            location.pathname ===
              `/client/v4/accounts/${config.accountId}/workers/subdomain/edge-preview` &&
            response.status === 200
          ) {
            const body: unknown = yield* response.json;
            if (object(body) && object(body.result)) {
              const exchange = body.result.exchange_url;
              if (typeof exchange === 'string') {
                let next: URL;
                try {
                  next = new URL(exchange);
                } catch {
                  return yield* Effect.die(
                    new Error('ISOLATION_EXCHANGE_URL_REJECTED'),
                  );
                }
                if (
                  next.protocol !== 'https:' ||
                  next.username ||
                  next.password ||
                  next.hash ||
                  exchangeUrls.size >= 16
                )
                  return yield* Effect.die(
                    new Error('ISOLATION_EXCHANGE_URL_REJECTED'),
                  );
                exchangeUrls.add(next.href);
              }
            }
          }
          if (
            location.hostname ===
              `alchemy-state-store.${config.workersDevSuffix}` ||
            location.hostname ===
              `${OSS_PREVIEW_STATE_STORE_WORKER}.${config.workersDevSuffix}`
          ) {
            const chunks: Uint8Array[] = [];
            let size = 0;
            yield* Stream.runForEach(response.stream, (chunk) =>
              Effect.sync(() => {
                size += chunk.byteLength;
                if (size > 16 * 1024 * 1024)
                  throw new Error('PREVIEW_RESPONSE_LIMIT');
                chunks.push(chunk);
              }),
            ).pipe(
              Effect.catchReason(
                'HttpClientError',
                'EmptyBodyError',
                () => Effect.void,
              ),
            );
            return HttpClientResponse.fromWeb(
              request,
              new Response(size ? Buffer.concat(chunks) : null, {
                status: response.status,
                headers: response.headers,
              }),
            );
          }
          return response;
        }),
      ),
    ),
  ).pipe(Layer.provide(foundation));
  const token = Redacted.make(config.apiToken);
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      foundation,
      guarded,
      Layer.succeed(
        Credentials,
        Effect.succeed(apiTokenCredentials({ apiToken: token })),
      ),
      Layer.succeed(
        CloudflareEnvironment,
        Effect.succeed({
          type: 'apiToken' as const,
          apiToken: token,
          accountId: config.accountId,
          source: { type: 'env' as const },
        }),
      ),
      Layer.succeed(
        Access,
        Access.of({
          getAccessHeaders: (domain) =>
            domain === `alchemy-state-store.${config.workersDevSuffix}` ||
            domain ===
              `${OSS_PREVIEW_STATE_STORE_WORKER}.${config.workersDevSuffix}`
              ? Effect.succeed({})
              : Effect.die(new Error('ISOLATION_ACCESS_ORIGIN_REJECTED')),
        }),
      ),
      Layer.succeed(Interaction.Interaction, quietInteraction()),
      Layer.succeed(FetchHttpClient.RequestInit, { redirect: 'error' }),
      Logger.layer([]),
    ),
  );
  type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;
  const run = async <A, E>(
    effect: Effect.Effect<A, E, Services>,
    code: string,
    timeout = 30_000,
  ): Promise<A> => {
    const result = await runtime.runPromiseExit(
      effect.pipe(Effect.timeout(timeout), Effect.provide(Logger.layer([]))),
    );
    if (Exit.isFailure(result)) throw new Error(code);
    return result.value;
  };
  return { run, destinationScopes, dispose: () => runtime.dispose() };
}

type IsolationRuntime = ReturnType<typeof makePreviewIsolationRuntime>;
const stateApi = (url: string, token: string) =>
  HttpApiClient.make(StateApi, {
    baseUrl: url,
    transformClient: HttpClient.mapRequest(
      HttpClientRequest.bearerToken(token),
    ),
  });

/** Connects raw encoded JSON; no client revival or backend auto-upgrade is involved. */
export async function previewWireReader(
  runtime: IsolationRuntime,
  config: PreviewIsolationClientConfig,
  workerName: string,
) {
  if (
    !['alchemy-state-store', OSS_PREVIEW_STATE_STORE_WORKER].includes(
      workerName,
    )
  )
    throw new Error('ISOLATION_STORE_IDENTITY_REJECTED');
  const credentials = await runtime.run(
    loginWithCloudflare(
      'oss-preview-isolation',
      true,
      workerName,
      config.accountId,
    ),
    'ISOLATION_STORE_LOGIN_FAILED',
    120_000,
  );
  if (
    credentials.url !== `https://${workerName}.${config.workersDevSuffix}` ||
    credentials.accountId !== config.accountId
  )
    throw new Error('ISOLATION_STORE_IDENTITY_REJECTED');
  return previewWirePort(
    runtime,
    config,
    workerName,
    credentials.url,
    credentials.authToken,
  );
}

/** Uses the pinned raw wire API after credential discovery has proven endpoint identity. */
export async function previewWirePort(
  runtime: IsolationRuntime,
  config: PreviewIsolationClientConfig,
  workerName: string,
  url: string,
  token: string,
) {
  if (
    !['alchemy-state-store', OSS_PREVIEW_STATE_STORE_WORKER].includes(
      workerName,
    ) ||
    url !== `https://${workerName}.${config.workersDevSuffix}`
  )
    throw new Error('ISOLATION_STORE_IDENTITY_REJECTED');
  const api = await runtime.run(
    stateApi(url, token),
    'ISOLATION_STORE_CLIENT_FAILED',
  );
  const reader: PreviewStateReader = {
    version: async () =>
      (
        await runtime.run(
          api.version.getVersion(),
          'ISOLATION_VERSION_READ_FAILED',
        )
      ).version,
    stacks: () =>
      runtime.run(api.state.listStacks(), 'ISOLATION_STACK_INVENTORY_FAILED'),
    stages: (stack) =>
      runtime.run(
        api.state.listStages({ params: { stack } }),
        'ISOLATION_STAGE_INVENTORY_FAILED',
      ),
    keys: (scope) =>
      runtime.run(
        api.state.listResources({ params: scope }),
        'ISOLATION_RESOURCE_INVENTORY_FAILED',
      ),
    get: async (key) =>
      previewWireValue(
        await runtime.run(
          api.state.getState({
            params: { ...key, fqn: encodeURIComponent(key.fqn) },
          }),
          'ISOLATION_RESOURCE_READ_FAILED',
        ),
      ),
    output: async (scope) =>
      previewWireValue(
        await runtime.run(
          api.state.getStackOutput({ params: scope }),
          'ISOLATION_OUTPUT_READ_FAILED',
        ),
      ),
  };
  return {
    ...reader,
    put: async (
      key: Parameters<PreviewStateDestination['put']>[0],
      value: Parameters<PreviewStateDestination['put']>[1],
    ) => {
      await runtime.run(
        api.state.setState({
          params: { ...key, fqn: encodeURIComponent(key.fqn) },
          payload: value,
        }),
        'ISOLATION_RESOURCE_WRITE_FAILED',
      );
    },
    putOutput: async (
      scope: Parameters<PreviewStateDestination['putOutput']>[0],
      value: Parameters<PreviewStateDestination['putOutput']>[1],
    ) => {
      await runtime.run(
        api.state.setStackOutput({ params: scope, payload: value }),
        'ISOLATION_OUTPUT_WRITE_FAILED',
      );
    },
  };
}

/** Lists registered script IDs without treating a failed lookup as absence. */
export async function isolationWorkerNames(
  runtime: IsolationRuntime,
  accountId: string,
) {
  const rows = await runtime.run(
    workers.listScripts({ accountId }),
    'ISOLATION_WORKER_INVENTORY_FAILED',
  );
  if (
    !Array.isArray(rows) ||
    rows.length >= 1000 ||
    rows.some((row) => !row.id) ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    throw new Error('ISOLATION_WORKER_INVENTORY_INCOMPLETE');
  return rows.map((row) => row.id);
}

/** Refuses any preexisting or uncertain target, including one without active versions. */
export async function isolationTargetExists(
  runtime: IsolationRuntime,
  config: PreviewIsolationClientConfig,
) {
  if (
    (await isolationWorkerNames(runtime, config.accountId)).includes(
      OSS_PREVIEW_STATE_STORE_WORKER,
    )
  )
    return true;
  const setting = await runtime.run(
    Effect.exit(
      workers.getScriptSetting({
        accountId: config.accountId,
        scriptName: OSS_PREVIEW_STATE_STORE_WORKER,
      }),
    ),
    'ISOLATION_TARGET_LOOKUP_FAILED',
  );
  if (Exit.isSuccess(setting)) return true;
  const reason = setting.cause.reasons.find(Cause.isFailReason)?.error;
  if (object(reason) && reason._tag === 'WorkerNotFound') return false;
  throw new Error('ISOLATION_TARGET_ABSENCE_UNPROVEN');
}

function clientConfig(
  env: Readonly<Record<string, string | undefined>>,
): PreviewIsolationClientConfig {
  const expected = env.PREVIEW_ACCOUNT_ID;
  const production = env.PRODUCTION_ACCOUNT_ID;
  if (
    !expected ||
    !production ||
    !/^[0-9a-f]{32}$/.test(expected) ||
    !/^[0-9a-f]{32}$/.test(production) ||
    expected === production ||
    env.EXPECTED_CLOUDFLARE_ACCOUNT_ID !== expected ||
    env.CLOUDFLARE_ACCOUNT_ID !== expected
  )
    throw new Error('ISOLATION_PREVIEW_ACCOUNT_REQUIRED');
  if (
    !env.CLOUDFLARE_API_TOKEN ||
    /\s/.test(env.CLOUDFLARE_API_TOKEN) ||
    !env.PREVIEW_WORKERS_DEV_SUFFIX ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*\.workers\.dev$/.test(
      env.PREVIEW_WORKERS_DEV_SUFFIX,
    )
  )
    throw new Error('ISOLATION_PREVIEW_CREDENTIALS_REQUIRED');
  return {
    accountId: expected,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    workersDevSuffix: env.PREVIEW_WORKERS_DEV_SUFFIX,
  };
}

async function main() {
  const env = process.env;
  const context = previewIsolationContext(env);
  const request = isolationGithubRequest(env.GH_TOKEN);
  const guard = () => assertIsolationAuthority(request, context);
  await guard();
  assertIsolationSource(process.cwd(), context.sourceSha);
  const config = clientConfig(env);
  if (
    !env.ALCHEMY_HOME ||
    !env.RECEIPT_OUTPUT ||
    !env.RUNNER_TEMP ||
    !resolve(env.ALCHEMY_HOME).startsWith(`${resolve(env.RUNNER_TEMP)}/`)
  )
    throw new Error('ISOLATION_FRESH_AUTH_DIRECTORY_REQUIRED');
  await mkdir(env.ALCHEMY_HOME, { mode: 0o700 });
  const runtime = makePreviewIsolationRuntime(config);
  try {
    const workerNames = await isolationWorkerNames(runtime, config.accountId);
    const source = await previewWireReader(
      runtime,
      config,
      'alchemy-state-store',
    );
    const manifest = {
      pullNumbers: await isolationPullNumbers(request),
      workerNames,
      additionalStages: (env.ADDITIONAL_PREVIEW_STAGES ?? '')
        .split(/[\s,]+/)
        .filter(Boolean),
    };
    const targetExists = await isolationTargetExists(runtime, config);
    let receipt: object;
    if (context.mode === 'inventory') {
      if ((await source.version()) !== 7)
        throw new Error('PREVIEW_SOURCE_PROTOCOL_REJECTED');
      const snapshot = await snapshotPreviewState(source, manifest);
      receipt = {
        mode: 'inventory',
        sourceProtocol: 7,
        destinationExists: targetExists,
        scopes: snapshot.snapshots.map((scope) => ({
          stack: scope.stack,
          stage: scope.stage,
          resources: scope.rows.length,
          output: scope.output !== undefined,
        })),
        legacyWorkers: snapshot.legacy,
      };
    } else {
      let target: Awaited<ReturnType<typeof previewWireReader>> | undefined;
      const current = () => {
        if (!target) throw new Error('ISOLATION_TARGET_NOT_INITIALIZED');
        return target;
      };
      const destination: PreviewStateDestination = {
        exists: () => isolationTargetExists(runtime, config),
        initialize: async (scopes) => {
          for (const scope of scopes)
            runtime.destinationScopes.add(`${scope.stack}/${scope.stage}`);
          await guard();
          if (await isolationTargetExists(runtime, config))
            throw new Error('PREVIEW_DESTINATION_ALREADY_EXISTS');
          await runtime.run(
            bootstrap({
              workerName: OSS_PREVIEW_STATE_STORE_WORKER,
              accountId: config.accountId,
              profile: 'oss-preview-isolation',
              force: false,
            }),
            'ISOLATION_NAMED_BOOTSTRAP_FAILED',
            300_000,
          );
          target = await previewWireReader(
            runtime,
            config,
            OSS_PREVIEW_STATE_STORE_WORKER,
          );
        },
        version: () => current().version(),
        stacks: () => current().stacks(),
        stages: (name) => current().stages(name),
        keys: (scope) => current().keys(scope),
        get: (key) => current().get(key),
        output: (scope) => current().output(scope),
        put: (key, value) => current().put(key, value),
        putOutput: (scope, value) => current().putOutput(scope, value),
      };
      const proof = await copyPreviewState(
        source,
        destination,
        manifest,
        guard,
      );
      receipt = {
        ...proof,
        mode: 'copy',
        version: '2.0.0-beta.85',
        sourceProtocol: 7,
        destinationProtocol: 8,
        sourceWorker: 'alchemy-state-store',
        destinationWorker: OSS_PREVIEW_STATE_STORE_WORKER,
        defaultStorePreserved: true,
      };
    }
    await guard();
    await writeFile(
      env.RECEIPT_OUTPUT,
      JSON.stringify(
        {
          ...receipt,
          controlSha: context.controlSha,
          sourceSha: context.sourceSha,
          accountId: config.accountId,
          runId: context.runId,
          attempt: context.attempt,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    console.log(
      'Preview state isolation completed. Routing and workflows were not changed.',
    );
  } finally {
    await runtime.dispose();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error &&
        /^(ISOLATION|PREVIEW)_[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : 'ISOLATION_CLIENT_FAILED',
    );
    process.exitCode = 1;
  }
}
