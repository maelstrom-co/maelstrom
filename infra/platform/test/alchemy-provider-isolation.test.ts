import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { CloudflareEnvironment } from '@alchemy.run/cloudflare';
import { currentWorkerAccountId } from 'alchemy/WorkerAccount';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';

const project = resolve(import.meta.dirname, '..');
test('the installed platform shared package supports the catalog Effect version', () => {
  const require = createRequire(resolve(project, 'package.json'));
  const platform = require.resolve('@effect/platform-bun/package.json');
  const shared = createRequire(platform).resolve(
    '@effect/platform-node-shared/package.json',
  );
  const metadata = JSON.parse(readFileSync(shared, 'utf8'));
  const root = JSON.parse(
    readFileSync(resolve(project, '../../package.json'), 'utf8'),
  );
  expect(metadata.version).toBe(root.catalog.effect);
  expect(metadata.peerDependencies.effect).toBe(`^${root.catalog.effect}`);
});
const node = Bun.which('node');
if (!node)
  throw new Error('Node is required to verify the published Alchemy build');

for (const runtime of [process.execPath, node]) {
  test(`core plan and apply load without optional cloud providers (${runtime})`, () => {
    const result = spawnSync(
      runtime,
      [
        '--input-type=module',
        '-e',
        `
      const rejectProvider = (specifier) => {
        if (/^@alchemy\\.run\\/(cloudflare|aws)(\\/|$)/.test(specifier)) {
          throw new Error('Core imported an optional provider: ' + specifier);
        }
      };
      if (typeof Bun !== 'undefined') {
        Bun.plugin({ name: 'provider-isolation', setup(build) {
          build.onResolve({ filter: /^@alchemy\\.run\\// }, (args) => { rejectProvider(args.path); });
        }});
      } else {
        const { registerHooks } = await import('node:module');
        registerHooks({ resolve(specifier, context, next) {
          rejectProvider(specifier);
          return next(specifier, context);
        }});
      }
      await import('alchemy/Apply');
      await import('alchemy/Plan');
      console.log('core-isolated');
    `,
      ],
      { cwd: project, encoding: 'utf8', timeout: 15_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('core-isolated');
  });

  test(`the account guard reads the actual provider environment (${runtime})`, () => {
    const result = spawnSync(
      runtime,
      [
        '--input-type=module',
        '-e',
        `
      import { CloudflareEnvironment } from '@alchemy.run/cloudflare';
      import { currentWorkerAccountId } from 'alchemy/WorkerAccount';
      import * as Effect from 'effect/Effect';
      import * as Redacted from 'effect/Redacted';
      const accountId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const actual = await Effect.runPromise(currentWorkerAccountId.pipe(
        Effect.provideService(CloudflareEnvironment, Effect.succeed({
          type: 'apiToken', apiToken: Redacted.make('offline-token'), accountId,
          source: { type: 'env' },
        })),
      ));
      if (actual !== accountId) throw new Error('Account guard used a different service');
      console.log('account-matched');
    `,
      ],
      { cwd: project, encoding: 'utf8', timeout: 15_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('account-matched');
  });
}

test('the typed account reader uses the provider environment', async () => {
  const accountId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const result = await Effect.runPromise(
    currentWorkerAccountId.pipe(
      Effect.provideService(
        CloudflareEnvironment,
        Effect.succeed({
          type: 'apiToken',
          apiToken: Redacted.make('offline-token'),
          accountId,
          source: { type: 'env' },
        }),
      ),
    ),
  );
  expect(result).toBe(accountId);
});
