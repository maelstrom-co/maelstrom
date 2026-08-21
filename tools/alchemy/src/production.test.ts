import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'jsonc-parser';
import {
  isProductionStage,
  isStateInspectionStage,
  production,
} from './production.js';

const workspaceRoot = resolve(import.meta.dirname, '../../..');
const readJson = (path: string): unknown =>
  parse(readFileSync(resolve(workspaceRoot, path), 'utf8'));

describe('production infrastructure contract', () => {
  test('keeps application builds outside Alchemy secret resolution', async () => {
    const stackSource = await Bun.file(
      new URL('../alchemy.run.ts', import.meta.url),
    ).text();

    expect(stackSource).not.toContain('Cloudflare.Website');
    expect(stackSource).not.toContain('command:');
    expect(stackSource.match(/Cloudflare\.Worker\(/g)).toHaveLength(3);
  });

  test('keeps the public worker names and domains stable for adoption', () => {
    expect({
      www: [production.www.workerName, ...production.www.domains],
      docs: [production.docs.workerName, ...production.docs.domains],
      demo: [production.demo.workerName, ...production.demo.domains],
    }).toEqual({
      www: ['www', 'maelstrom-ai.co', 'www.maelstrom-ai.co'],
      docs: ['docs', 'docs.maelstrom-ai.co'],
      demo: ['maelstrom-playground', 'demo.maelstrom-ai.co'],
    });
  });

  test('matches the active www Wrangler contract before adoption', () => {
    expect(readJson('apps/www/wrangler.jsonc')).toMatchObject({
      name: production.www.workerName,
      compatibility_date: production.www.compatibilityDate,
      compatibility_flags: production.www.compatibilityFlags,
      routes: production.www.domains.map((pattern) => ({
        pattern,
        custom_domain: true,
      })),
      d1_databases: [
        {
          binding: production.www.bindings.database,
          database_name: production.waitlist.databaseName,
        },
      ],
      send_email: [
        {
          name: production.www.bindings.email,
          allowed_sender_addresses: [production.www.senderAddress],
        },
      ],
      secrets: {
        required: [production.www.bindings.turnstileSecret],
      },
    });
  });

  test('matches the active docs Wrangler contract before adoption', () => {
    expect(readJson('apps/docs/wrangler.json')).toMatchObject({
      name: production.docs.workerName,
      compatibility_date: production.docs.compatibilityDate,
      routes: [{ pattern: production.docs.domains[0], custom_domain: true }],
      assets: { directory: './dist' },
    });
  });

  test('matches the active hosted demo and Durable Object contracts', () => {
    expect(production.demo).toMatchObject({
      main: '../../apps/demo/src/worker/index.ts',
      assets: '../../apps/demo/dist/client',
      notFoundHandling: 'single-page-application',
      runWorkerFirst: ['/ws'],
      durableObject: {
        binding: 'SESSION_DO',
        className: 'SessionDO',
      },
    });
    expect(readJson('apps/demo/wrangler.jsonc')).toMatchObject({
      name: production.demo.workerName,
      compatibility_date: production.demo.compatibilityDate,
      main: 'src/worker/index.ts',
      routes: [{ pattern: production.demo.domains[0], custom_domain: true }],
      assets: {
        directory: './dist/client',
        binding: 'ASSETS',
        not_found_handling: production.demo.notFoundHandling,
        run_worker_first: production.demo.runWorkerFirst,
      },
      durable_objects: {
        bindings: [
          {
            name: production.demo.durableObject.binding,
            class_name: production.demo.durableObject.className,
          },
        ],
      },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['SessionDO'] }],
    });
    expect(readJson('apps/demo/package.json')).toMatchObject({
      nx: {
        targets: {
          'build-hosted': {
            options: { command: 'VITE_HOSTED=1 vite build' },
          },
        },
      },
    });
  });

  test('keeps the hybrid www build and docs static deployment shape', () => {
    expect(production.www).toMatchObject({
      main: '../../apps/www/dist/server/entry.mjs',
      assets: '../../apps/www/dist/client',
      bundle: false,
      bindings: {
        database: 'WAITLIST_DB',
        email: 'EMAIL',
        images: 'IMAGES',
        turnstileSecret: 'TURNSTILE_SECRET_KEY',
      },
      compatibilityDate: '2026-07-22',
      compatibilityFlags: ['nodejs_compat'],
    });
    expect(production.docs).toMatchObject({
      compatibilityDate: '2026-03-30',
      assets: '../../apps/docs/dist',
    });
  });

  test('rejects every stage that could create parallel app resources', () => {
    expect(isProductionStage('prod')).toBe(true);
    expect(isProductionStage('preview')).toBe(false);
    expect(isProductionStage('pr-118')).toBe(false);
  });

  test('recognizes Alchemy state inspection without treating it as production', () => {
    expect(isStateInspectionStage('placeholder')).toBe(true);
    expect(isStateInspectionStage('prod')).toBe(false);
  });
});
