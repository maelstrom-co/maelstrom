import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  inspectNarrationStorage,
  reconcileNarrationStorage,
} from '../narration-storage.js';
import { narrationBucketProps } from '../src/NarrationStorage.js';
import {
  narrationProfile,
  narrationStorage,
  narrationTarget,
  requireNarrationTarget,
  type NarrationStorageKind,
} from '../src/NarrationStorageContract.js';
import {
  OSS_PREVIEW_STACKS,
  OSS_PREVIEW_STAGE_PATTERN,
} from '../src/PreviewStateStoreContract.js';

const production = 'a'.repeat(32);
const preview = 'b'.repeat(32);
const bucketId = 'c'.repeat(32);
const domain = `pub-${bucketId}.r2.dev`;
const accounts = {
  PRODUCTION_ACCOUNT_ID: production,
  PREVIEW_ACCOUNT_ID: preview,
};

function fixture(kind: NarrationStorageKind) {
  const target = narrationTarget(kind, accounts);
  const desired = narrationBucketProps(kind);
  let saved = desired;
  let stateReady = false;
  let exists = false;
  let apiStatus = 200;
  let probeStatus = 404;
  let stdoutOverride: string | undefined;
  let exitCode = 0;
  const extraRows: string[] = [];
  let addRowOnDryRun = false;
  let ownershipOverrides: Record<string, unknown> = {};
  const commands: { args: readonly string[]; accountId: string }[] = [];
  const requests: string[] = [];
  const envelope = (result: object) =>
    Response.json({ result, success: true, errors: [] });
  const error = (status: number, code: number) =>
    Response.json({ success: false, errors: [{ code }] }, { status });

  const deps = {
    token: 'fixture-management-token',
    async runAlchemy(args: readonly string[], accountId: string) {
      commands.push({ args, accountId });
      if (args[1] === 'inventory') {
        return {
          code: 0,
          stdout: JSON.stringify([
            ...(stateReady ? [target.fqn] : []),
            ...extraRows,
          ]),
        };
      }
      if (args[0] === 'deploy') {
        if (args.includes('--dry-run') && addRowOnDryRun)
          extraRows.push('Other/DestroyableResource');
        if (!args.includes('--dry-run')) {
          stateReady = exists = true;
          saved = desired;
        }
        return { code: 0, stdout: '' };
      }
      return {
        code: exitCode,
        stdout:
          stdoutOverride ??
          (stateReady
            ? JSON.stringify({
                resourceType: 'Cloudflare.R2.Bucket',
                fqn: target.fqn,
                logicalId: target.fqn,
                providerMode: 'live',
                status: 'created',
                removalPolicy: 'retain',
                props: saved,
                attr: {
                  bucketName: target.bucket,
                  accountId: target.accountId,
                  domains: [],
                  cors: saved.cors,
                  lifecycleRules: saved.lifecycleRules,
                  publicDomain: target.public ? domain : undefined,
                },
                ...ownershipOverrides,
              })
            : `(not found: ${target.stack}/${target.stage}/${target.fqn})\n`),
      };
    },
    async request(url: string, init: RequestInit) {
      requests.push(url);
      expect(init.redirect).toBe('error');
      if (url.startsWith(`https://${domain}/`)) {
        expect(init.method).toBe('HEAD');
        expect(init.credentials).toBe('omit');
        expect(init.headers).toBeUndefined();
        return new Response(null, { status: probeStatus });
      }
      expect(url).toStartWith(
        `https://api.cloudflare.com/client/v4/accounts/${target.accountId}/r2/buckets/${target.bucket}`,
      );
      expect(new Headers(init.headers).get('authorization')).toBe(
        'Bearer fixture-management-token',
      );
      if (apiStatus !== 200) return error(apiStatus, 10006);
      if (!exists) return error(404, 10006);
      if (url.endsWith('/managed'))
        return envelope({ domain, bucketId, enabled: target.public });
      if (url.endsWith('/custom')) return envelope({ domains: [] });
      if (url.endsWith('/lifecycle'))
        return envelope({
          rules: saved.lifecycleRules.map(({ prefix, ...rule }) => ({
            ...rule,
            conditions: { prefix },
          })),
        });
      if (url.endsWith('/cors')) {
        return saved.cors.length
          ? envelope({
              rules: saved.cors.map((rule) => ({
                id: rule.id,
                maxAgeSeconds: rule.maxAgeSeconds,
                exposeHeaders: rule.exposeHeaders,
                allowed: {
                  methods: rule.allowedMethods,
                  origins: rule.allowedOrigins,
                  headers: rule.allowedHeaders,
                },
              })),
            })
          : error(404, 10059);
      }
      return envelope({ name: target.bucket, jurisdiction: 'default' });
    },
  };

  return {
    target,
    deps,
    commands,
    requests,
    seed(props = desired) {
      stateReady = exists = true;
      saved = props;
    },
    collision() {
      exists = true;
    },
    forbid() {
      apiStatus = 403;
    },
    badProbe() {
      probeStatus = 401;
    },
    onPlanAddOrphan() {
      addRowOnDryRun = true;
    },
    seedOrphan() {
      extraRows.push('Other/DestroyableResource');
    },
    invalidState(overrides: Record<string, unknown>) {
      ownershipOverrides = overrides;
    },
    cliOutput(stdout: string, code = 0) {
      stdoutOverride = stdout;
      exitCode = code;
    },
  };
}

describe('retained narration storage', () => {
  test('declares separate retained stacks with a production state account and excludes per-PR stages', () => {
    expect(narrationTarget('cache', accounts).accountId).toBe(production);
    expect(narrationTarget('delivery', accounts)).toMatchObject({
      accountId: preview,
      stateAccountId: production,
    });
    for (const target of Object.values(narrationStorage)) {
      expect(
        OSS_PREVIEW_STACKS.some(
          ({ stack }) => stack === (target.stack as string),
        ),
      ).toBe(false);
      expect(OSS_PREVIEW_STAGE_PATTERN.test(target.stage)).toBe(false);
    }
    expect(narrationBucketProps('cache')).toMatchObject({
      publicAccess: false,
      domains: [],
      cors: [],
      lifecycleRules: [],
      forceDestroy: false,
    });
    expect(narrationBucketProps('delivery')).toMatchObject({
      publicAccess: true,
      domains: [],
      forceDestroy: false,
      cors: [{ allowedMethods: ['GET', 'HEAD'], allowedHeaders: ['range'] }],
      lifecycleRules: [
        { deleteObjectsTransition: { condition: { maxAge: 2_592_000 } } },
      ],
    });
    const stack = readFileSync(
      new URL('../src/NarrationStorage.ts', import.meta.url),
      'utf8',
    );
    expect(stack).toContain(
      'Cloudflare.state({ accountId: narrationAccounts().production })',
    );
    expect(stack).toContain('retain(true)');
    expect(() =>
      requireNarrationTarget('delivery', 'pr-3', {
        ...accounts,
        CLOUDFLARE_ACCOUNT_ID: preview,
        ALCHEMY_PROFILE: narrationProfile,
      }),
    ).toThrow('declared target');
    expect(() =>
      requireNarrationTarget('delivery', 'shared-preview', {
        ...accounts,
        CLOUDFLARE_ACCOUNT_ID: production,
        ALCHEMY_PROFILE: narrationProfile,
      }),
    ).toThrow('declared target');
    expect(() =>
      requireNarrationTarget('delivery', 'shared-preview', {
        ...accounts,
        CLOUDFLARE_ACCOUNT_ID: preview,
        ALCHEMY_PROFILE: 'preview-ci',
      }),
    ).toThrow('declared target');
    expect(() =>
      narrationTarget('cache', { ...accounts, PREVIEW_ACCOUNT_ID: production }),
    ).toThrow('distinct');
  });

  test('creates and independently rediscovers each resource, then verifies an unchanged second reconciliation', async () => {
    for (const kind of ['cache', 'delivery'] as const) {
      const { target, deps, commands } = fixture(kind);
      expect(await inspectNarrationStorage(target, deps)).toBeUndefined();
      const expected = {
        account: target.accountId,
        bucket: target.bucket,
        origin: kind === 'delivery' ? `https://${domain}` : undefined,
      };
      for (let run = 0; run < 2; run++) {
        expect(
          await reconcileNarrationStorage(target, deps, async () => true),
        ).toEqual(expected);
        expect(await inspectNarrationStorage(target, deps)).toEqual(expected);
      }
      expect(
        commands
          .filter(({ args }) => args[0] === 'state')
          .every(
            ({ args, accountId }) =>
              accountId === production &&
              args.includes(target.stack) &&
              args.includes(target.stage) &&
              (args[1] === 'inventory' || args.includes(target.fqn)) &&
              args.includes('narration-state.run.ts'),
          ),
      ).toBe(true);
      expect(commands.filter(({ args }) => args[0] === 'deploy')).toEqual([
        {
          accountId: target.accountId,
          args: [
            'deploy',
            target.entrypoint,
            '--stage',
            target.stage,
            '--profile',
            narrationProfile,
            '--include',
            target.fqn,
            '--yes',
            '--dry-run',
          ],
        },
        {
          accountId: target.accountId,
          args: [
            'deploy',
            target.entrypoint,
            '--stage',
            target.stage,
            '--profile',
            narrationProfile,
            '--include',
            target.fqn,
            '--yes',
          ],
        },
        {
          accountId: target.accountId,
          args: [
            'deploy',
            target.entrypoint,
            '--stage',
            target.stage,
            '--profile',
            narrationProfile,
            '--include',
            target.fqn,
            '--yes',
            '--dry-run',
          ],
        },
        {
          accountId: target.accountId,
          args: [
            'deploy',
            target.entrypoint,
            '--stage',
            target.stage,
            '--profile',
            narrationProfile,
            '--include',
            target.fqn,
            '--yes',
          ],
        },
      ]);
    }
  });

  test('validates old managed settings before planning a deliberate CORS change and requires new settings after apply', async () => {
    const mock = fixture('delivery');
    const desired = narrationBucketProps('delivery');
    mock.seed({
      ...desired,
      cors: desired.cors.map((rule) => ({ ...rule, maxAgeSeconds: 60 })),
    });
    await expect(
      inspectNarrationStorage(mock.target, mock.deps),
    ).rejects.toThrow('configuration drift');
    expect(
      await reconcileNarrationStorage(mock.target, mock.deps, async () => true),
    ).toMatchObject({ origin: `https://${domain}` });
    expect(await inspectNarrationStorage(mock.target, mock.deps)).toMatchObject(
      { origin: `https://${domain}` },
    );
  });

  test('skips an unconfigured or stale runner and rechecks the current head before applying', async () => {
    const mock = fixture('cache');
    expect(
      await inspectNarrationStorage(mock.target, { ...mock.deps, token: '' }),
    ).toBeUndefined();
    expect(
      await reconcileNarrationStorage(
        mock.target,
        mock.deps,
        async () => false,
      ),
    ).toBeUndefined();
    expect(mock.commands).toHaveLength(0);
    let checks = 0;
    await reconcileNarrationStorage(
      mock.target,
      mock.deps,
      async () => ++checks === 1,
    );
    expect(
      mock.commands.filter(({ args }) => args[0] === 'deploy'),
    ).toHaveLength(1);
    expect(
      mock.commands.find(({ args }) => args[0] === 'deploy')?.args,
    ).toContain('--dry-run');
  });

  test('never treats a collision, permission failure, malformed state, or bad public endpoint as a verified output', async () => {
    const collision = fixture('cache');
    collision.collision();
    await expect(
      reconcileNarrationStorage(
        collision.target,
        collision.deps,
        async () => true,
      ),
    ).rejects.toThrow('collision');
    expect(collision.commands.map(({ args }) => args[1])).toEqual([
      'inventory',
      'get',
    ]);

    const denied = fixture('cache');
    denied.forbid();
    await expect(
      inspectNarrationStorage(denied.target, denied.deps),
    ).rejects.toThrow('HTTP 403');

    const malformed = fixture('cache');
    malformed.cliOutput('(not found: Wrong/prod/NarrationCache)\n');
    await expect(
      inspectNarrationStorage(malformed.target, malformed.deps),
    ).rejects.toThrow();
    malformed.cliOutput(
      '(not found: MaelstromNarrationCache/prod/NarrationCache)\n',
      2,
    );
    await expect(
      inspectNarrationStorage(malformed.target, malformed.deps),
    ).rejects.toThrow('exit 2');
    expect(malformed.requests).toHaveLength(0);

    const wrong = fixture('cache');
    wrong.seed();
    wrong.invalidState({
      attr: { accountId: preview, bucketName: wrong.target.bucket },
    });
    await expect(
      inspectNarrationStorage(wrong.target, wrong.deps),
    ).rejects.toThrow('ownership');

    const endpoint = fixture('delivery');
    endpoint.badProbe();
    await expect(
      reconcileNarrationStorage(
        endpoint.target,
        endpoint.deps,
        async () => true,
      ),
    ).rejects.toThrow('probe failed');
  });
});

test('checks the whole stage inventory before planning and rechecks it before apply', async () => {
  for (const insertedDuringPlan of [false, true]) {
    const mock = fixture('cache');
    mock.seed();
    if (insertedDuringPlan) mock.onPlanAddOrphan();
    else mock.seedOrphan();
    await expect(
      reconcileNarrationStorage(mock.target, mock.deps, async () => true),
    ).rejects.toThrow('Unexpected resource in narration state inventory');
    const deploys = mock.commands.filter(({ args }) => args[0] === 'deploy');
    expect(deploys).toHaveLength(insertedDuringPlan ? 1 : 0);
    expect(deploys.every(({ args }) => args.includes('--dry-run'))).toBe(true);
  }
});
