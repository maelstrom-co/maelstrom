import { resolve } from 'node:path';

import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

const root = resolve(import.meta.dirname, '..');
const build = await Bun.build({
  entrypoints: [resolve(root, 'src/worker/index.ts')],
  target: 'browser',
  conditions: ['@maelstrom-co/source'],
  external: ['cloudflare:workers', 'node:*'],
});
if (!build.success)
  throw new AggregateError(build.logs, 'Worker bundle failed');
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: await build.outputs[0].text(),
    host: '127.0.0.1',
    port: Number(process.env.AGUI_PORT ?? 4311),
    compatibilityDate: '2026-07-22',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: {
      WORKSPACES: { className: 'WorkspaceDO', useSQLite: true },
    },
    resourcePersistencePath:
      process.env.AGUI_STORAGE ?? resolve(root, '.wrangler/state/agui'),
    assets: {
      directory: resolve(root, 'dist/client'),
      binding: 'ASSETS',
      routerConfig: {
        has_user_worker: true,
        static_routing: { user_worker: ['/api/*'] },
      },
      assetConfig: { not_found_handling: 'single-page-application' },
    },
  }),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void runtime.dispose().then(() => process.exit(0));
  });
console.log(`Durable AG-UI workspace: ${await runtime.ready}`);
