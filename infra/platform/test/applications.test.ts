import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'jsonc-parser';

const workspaceRoot = resolve(import.meta.dirname, '../../..');
const read = (path: string) =>
  readFileSync(resolve(workspaceRoot, path), 'utf8');
const readJson = (path: string): unknown => parse(read(path));
const productionWorkflow = read('.github/workflows/deploy-production.yml');
const deploymentSourcePaths = [
  ...new Bun.Glob('apps/*/alchemy*.run.ts').scanSync({ cwd: workspaceRoot }),
  ...new Bun.Glob('apps/*/infra/**/*.ts').scanSync({ cwd: workspaceRoot }),
  ...new Bun.Glob('infra/platform/alchemy.run.ts').scanSync({
    cwd: workspaceRoot,
  }),
  ...new Bun.Glob('infra/platform/src/**/*.ts').scanSync({
    cwd: workspaceRoot,
  }),
].sort();

const section = (source: string, marker: string, nextMarker: string) => {
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(nextMarker, start + marker.length);
  return source.slice(start, end === -1 ? source.length : end);
};

const namedStep = (source: string, name: string) =>
  section(source, `      - name: ${name}\n`, '\n      - ');

const workflowStep = (name: string) => namedStep(productionWorkflow, name);
const expression = (value: string) => ['$', `{{ ${value} }}`].join('');
const workflowJob = (name: string, nextName: string) =>
  section(productionWorkflow, `  ${name}:\n`, `\n  ${nextName}:\n`);

const matrixApp = (name: string) =>
  section(
    productionWorkflow,
    `          - app: ${name}\n`,
    '\n          - app:',
  );

const expectStepOrder = (source: string, ...names: string[]) => {
  const positions = names.map((name) => {
    const position = source.indexOf(`      - name: ${name}\n`);
    expect(position).toBeGreaterThanOrEqual(0);
    return position;
  });
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
};

const expectWorkflowOrder = (...names: string[]) =>
  expectStepOrder(productionWorkflow, ...names);

const isRepositorySurface = (path: string) =>
  !/(?:^|\/)(?:node_modules|dist|\.wrangler)(?:\/|$)/u.test(path);

const collectCommandFields = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(collectCommandFields);
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, child]) => {
    if (key === 'command' && typeof child === 'string') return [child];
    if (key === 'commands' && Array.isArray(child)) {
      return child.flatMap((command) =>
        typeof command === 'string' ? [command] : collectCommandFields(command),
      );
    }
    return collectCommandFields(child);
  });
};

const collectWorkflowCommands = (source: string): string[] => {
  const lines = source.split('\n');
  const commands: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const match = lines[index]?.match(
      /^(\s*)(?:-\s*)?(?:run|command):\s*(.*)$/,
    );
    if (!match) continue;
    const [, indentation = '', value = ''] = match;
    if (!/^[>|]/u.test(value)) {
      commands.push(value);
      continue;
    }

    const block: string[] = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? '';
      if (
        next.trim() &&
        (next.match(/^\s*/)?.[0].length ?? 0) <= indentation.length
      ) {
        break;
      }
      block.push(next);
      index++;
    }
    commands.push(block.join('\n'));
  }

  return commands;
};

const invokesWrangler = (command: string) =>
  /(?:^|[\s;&|])["']?(?:bunx?\s+|npx\s+|pnpm\s+exec\s+|yarn\s+dlx\s+|\S*\/)?wrangler(?=[\s"']|$)/iu.test(
    command,
  );

const expectNoWranglerExecutable = (commands: string[]) => {
  for (const command of commands) {
    expect(invokesWrangler(command)).toBe(false);
  }
};

describe('application infrastructure contract', () => {
  test('declares the Node platform peer required by Alchemy Cloudflare Workers', () => {
    const packagePaths = [
      ...new Bun.Glob('apps/*/package.json').scanSync({ cwd: workspaceRoot }),
      ...new Bun.Glob('infra/*/package.json').scanSync({ cwd: workspaceRoot }),
    ];
    const alchemyPackages = packagePaths.filter((path) => {
      const packageJson = readJson(path) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return Boolean(
        packageJson.dependencies?.alchemy ??
          packageJson.devDependencies?.alchemy,
      );
    });
    expect(alchemyPackages).not.toEqual([]);

    for (const path of alchemyPackages) {
      const packageJson = readJson(path) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      expect(dependencies['@effect/platform-node']).toBe(
        dependencies['@effect/platform-bun'],
      );
    }
  });

  test('pins Effect to the Alchemy-compatible catalog version and leaves the language service unwired', () => {
    const root = readJson('package.json') as {
      catalog?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const catalog = root.catalog ?? {};
    expect(catalog.effect).toBe('4.0.5');
    expect(catalog['@effect/platform-node']).toBe(catalog.effect);
    expect(catalog['@effect/platform-bun']).toBe(catalog.effect);
    expect(catalog['@effect/sql-d1']).toBe(catalog.effect);

    const packagePaths = [
      'package.json',
      ...new Bun.Glob('apps/*/package.json').scanSync({ cwd: workspaceRoot }),
      ...new Bun.Glob('infra/*/package.json').scanSync({ cwd: workspaceRoot }),
    ];
    for (const path of packagePaths) {
      const packageJson = readJson(path) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
      expect(dependencies['@effect/language-service']).toBeUndefined();
      const consumesEffectCatalog = Boolean(
        dependencies.effect ||
          dependencies['@effect/platform-node'] ||
          dependencies['@effect/platform-bun'],
      );
      if (!consumesEffectCatalog) continue;
      if (dependencies.effect) expect(dependencies.effect).toBe('catalog:');
      if (dependencies['@effect/platform-node']) {
        expect(dependencies['@effect/platform-node']).toBe('catalog:');
      }
      if (dependencies['@effect/platform-bun']) {
        expect(dependencies['@effect/platform-bun']).toBe('catalog:');
      }
    }
  });

  test('gives each independently deployed app its own composition root', () => {
    expect(read('apps/www/alchemy.run.ts')).toContain("'MaelstromWww'");
    expect(read('apps/docs/alchemy.run.ts')).toContain("'MaelstromDocs'");
    expect(read('apps/demo/alchemy.run.ts')).toContain("'MaelstromDemo'");
  });

  test('has no deployment resource adoption after the production Zone bootstrap', () => {
    const adoptionCalls = deploymentSourcePaths.flatMap((path) => {
      const source = read(path)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      return [...source.matchAll(/\badopt\(/g)].map(() => path);
    });
    expect(adoptionCalls).toEqual([]);
  });

  test('derives the sending subdomain zone from the managed Zone resource', () => {
    const waitlist = read('infra/platform/src/Waitlist.ts');
    expect(waitlist).toContain('zoneId: zone.zoneId');
    // The deployed Zone resource is the only source of zone identity.
    expect(waitlist).not.toContain("'4df25ea08d364f19471be7a179ce9f02'");
  });

  test('deploys the credential-free docs artifact through Alchemy', () => {
    const website = read('apps/docs/infra/Website.ts');
    expect(website).toMatch(/Cloudflare\.Worker\(\s*'Website'/);
    expect(website).toContain(
      "assets: { directory: resolve(appRoot, 'dist') }",
    );
    expect(website).not.toContain('Cloudflare.Website.Astro');
    expect(readJson('apps/docs/package.json')).toMatchObject({
      nx: {
        targets: {
          deploy: {
            options: { command: 'alchemy deploy --stage prod' },
          },
        },
      },
    });

    const previewStack = read('apps/docs/alchemy.preview.run.ts');
    expect(previewStack).toContain("'MaelstromDocsPreview'");
    expect(previewStack).toContain("requirePreviewStage('docs preview')");
    const previewWebsite = read('apps/docs/infra/PreviewWebsite.ts');
    expect(previewWebsite).toContain(
      `name: \`maelstrom-docs-alchemy-${'$'}{stage}\``,
    );
    expect(previewWebsite).toContain('workersDev: true');
    expect(previewWebsite).not.toContain('domain:');
    expect(previewWebsite).not.toContain('retain(');
  });

  test('deploys the prebuilt www Worker through Alchemy', () => {
    const website = read('apps/www/infra/Website.ts');
    expect(website).toMatch(/Cloudflare\.Worker\(\s*'Website'/);
    expect(website).toContain('workersDev: false');
    expect(website).toContain('dist/server/entry.mjs');
    expect(website).toContain('dist/client');
    expect(website).not.toContain('Cloudflare.Website.Astro');
    expect(website).toContain('yield* WaitlistDatabase');
    expect(website).toContain('yield* WaitlistTurnstile');
    expect(website).not.toContain('Cloudflare.D1.Database(');
    expect(website).not.toContain('Cloudflare.Turnstile.Widget(');
    expect(website).not.toContain('Cloudflare.Email.SendingSubdomain(');
    expect(website).not.toContain('adopt(');
    expect(readJson('apps/www/package.json')).toMatchObject({
      nx: {
        targets: {
          deploy: {
            options: { command: 'alchemy deploy --stage prod' },
          },
        },
      },
    });

    const previewStack = read('apps/www/alchemy.preview.run.ts');
    expect(previewStack).toContain("'MaelstromWwwPreview'");
    expect(previewStack).toContain("requirePreviewStage('www preview')");
    const previewWebsite = read('apps/www/infra/PreviewWebsite.ts');
    expect(previewWebsite).toContain(
      `name: \`maelstrom-www-alchemy-${'$'}{stage}\``,
    );
    expect(previewWebsite).toContain('workersDev: true');
    expect(previewWebsite).toContain("Cloudflare.Images.Images('IMAGES')");
    expect(previewWebsite).not.toContain('WaitlistDatabase');
    expect(previewWebsite).not.toContain('WaitlistTurnstile');
    expect(previewWebsite).not.toContain('SendEmail');
    expect(previewWebsite).not.toContain('domain:');
    expect(previewWebsite).not.toContain('retain(');
  });

  test('preserves the hosted demo and Durable Object contracts', () => {
    const website = read('apps/demo/infra/Website.ts');
    const workerEnv = read('apps/demo/infra/workerEnv.ts');
    expect(website).toMatch(/Cloudflare\.Worker\(\s*'Website'/);
    expect(website).toContain('workersDev: false');
    expect(website).toContain("name: 'maelstrom-playground'");
    expect(website).toContain("main: resolve(appRoot, 'src/worker/index.ts')");
    expect(website).toContain('env: workerEnv()');
    expect(workerEnv).toContain("className: 'SessionDO'");
    expect(workerEnv).toContain("Cloudflare.RateLimit('WS_RATE_LIMITER'");
    expect(website).toContain("runWorkerFirst: ['/ws']");
    expect(readJson('apps/demo/package.json')).toMatchObject({
      nx: {
        targets: {
          deploy: {
            options: { command: 'alchemy deploy --stage prod' },
          },
        },
      },
    });

    const previewStack = read('apps/demo/alchemy.preview.run.ts');
    expect(previewStack).toContain("'MaelstromDemoPreview'");
    expect(previewStack).toContain("requirePreviewStage('demo preview')");
    const previewWebsite = read('apps/demo/infra/PreviewWebsite.ts');
    expect(previewWebsite).toContain(
      `name: \`maelstrom-playground-alchemy-${'$'}{stage}\``,
    );
    expect(previewWebsite).toContain('workersDev: true');
    expect(previewWebsite).toContain('env: workerEnv()');
    expect(previewWebsite).toContain("runWorkerFirst: ['/ws']");
    expect(previewWebsite).not.toContain('transferredFrom');
    expect(previewWebsite).not.toContain('domain:');
    expect(previewWebsite).not.toContain('retain(');
  });

  test('keeps production builds credential-free and deploys every app through Alchemy', () => {
    const platformJob = workflowJob('platform', 'deploy');
    const applicationJob = productionWorkflow.slice(
      productionWorkflow.indexOf('  deploy:\n'),
    );
    expect(applicationJob).toContain('needs: platform');
    expect(applicationJob).toContain(
      "needs.platform.outputs.deployed == 'true'",
    );

    const platformRecheck = namedStep(
      platformJob,
      'Recheck platform deployment revision',
    );
    expect(platformRecheck).toContain('bun scripts/latest-green-ci.ts');
    const platformDeploy = namedStep(
      platformJob,
      'Deploy platform to Cloudflare with Alchemy',
    );
    expect(platformDeploy).toContain(
      "if: steps.platform-revision.outputs.current == 'true'",
    );
    expect(platformDeploy).toContain(
      'bun alchemy deploy --stage prod --profile production-ci --yes',
    );
    expect(platformDeploy).toContain(
      'bun ../../scripts/cloudflare-rate-limit-preflight.ts\n' +
        '          bun alchemy deploy --stage prod --profile production-ci --dry-run --yes',
    );
    // The live-phase check must also immediately precede the mutating apply,
    // or the planning time widens the window where another actor's phase
    // change could be erased.
    expect(platformDeploy).toContain(
      'bun alchemy deploy --stage prod --profile production-ci --dry-run --yes\n' +
        '          bun ../../scripts/cloudflare-rate-limit-preflight.ts\n' +
        '          bun alchemy deploy --stage prod --profile production-ci --yes\n' +
        '          zone_state=',
    );
    expect(platformDeploy).toContain(
      'bun ../../scripts/cloudflare-rate-limit-preflight.ts state\n' +
        '          bun ../../scripts/cloudflare-rate-limit-preflight.ts verify',
    );
    expect(platformDeploy).not.toContain('wrangler');
    expect(platformDeploy).toContain('CLOUDFLARE_ACCOUNT_ID:');
    expect(platformDeploy).toContain('CLOUDFLARE_API_TOKEN:');
    expect(platformDeploy).toContain('--fqn WaitlistTurnstile');
    expect(platformDeploy).toContain('turnstile-sitekey=');
    expect(platformDeploy).toMatch(/0x\[A-Za-z0-9/);
    expect(platformDeploy).toContain('--fqn ProductionZone');
    expect(platformDeploy).toContain('--fqn ProductionRateLimit');
    expect(platformDeploy).toContain(
      'printf \'%s\' "$ruleset_state" | bun ../../scripts/cloudflare-rate-limit-preflight.ts state',
    );
    expect(platformDeploy).not.toContain('rules[0]?.id');
    expect(platformDeploy).toContain(
      "zoneId !== '4df25ea08d364f19471be7a179ce9f02'",
    );
    expect(platformDeploy).toContain("name !== 'maelstrom-ai.co'");
    expect(platformDeploy).toContain(
      "accountId !== '36ef30d02761b97ffb49b343ac17f2d2'",
    );
    expect(platformDeploy).toContain(
      'bun alchemy deploy --stage prod --profile production-ci --yes\n' +
        '          zone_state=',
    );
    expect(platformDeploy.indexOf('--fqn ProductionZone')).toBeLessThan(
      platformDeploy.indexOf('--fqn ProductionRateLimit'),
    );
    expect(platformDeploy.indexOf('--fqn ProductionRateLimit')).toBeLessThan(
      platformDeploy.indexOf('--fqn WaitlistTurnstile'),
    );
    expect(platformJob).toContain(
      `turnstile-sitekey: ${'$'}{{ steps.deploy-platform.outputs.turnstile-sitekey }}`,
    );

    const www = matrixApp('www');
    expect(www).toContain('directory: apps/www');
    const docs = matrixApp('docs');
    expect(docs).toContain('directory: apps/docs');
    const demo = matrixApp('demo');
    expect(demo).toContain('directory: apps/demo');

    expect(productionWorkflow).toContain(
      `group: production-${'$'}{{ matrix.app }}`,
    );

    const initialCheck = workflowStep('Check deployment revision');
    expect(initialCheck).toContain('id: revision');
    expect(initialCheck).toContain('bun scripts/latest-green-ci.ts');
    expect(initialCheck).toContain(
      'if [ "$latest_green_sha" = "$DEPLOY_SHA" ]; then',
    );

    const build = workflowStep('Build production artifact');
    expect(build).toContain("steps.revision.outputs.current == 'true'");
    expect(build).not.toMatch(
      /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)|ALCHEMY_PROFILE/,
    );
    expect(build).toContain('PUBLIC_TURNSTILE_ENVIRONMENT: production');
    expect(build).toContain(
      `PUBLIC_TURNSTILE_SITE_KEY: ${'$'}{{ matrix.app == 'www' && needs.platform.outputs.turnstile-sitekey || '' }}`,
    );

    const recheck = workflowStep('Recheck deployment revision');
    expect(recheck).toContain('id: deploy-revision');
    expect(recheck).toContain('bun scripts/latest-green-ci.ts');
    expect(recheck).toContain(
      'if [ "$latest_green_sha" = "$DEPLOY_SHA" ]; then',
    );

    const alchemyDeploy = workflowStep('Deploy to Cloudflare with Alchemy');
    // The dry-run plan must precede and gate the mutating deploy.
    expect(alchemyDeploy).toContain(
      'bun alchemy deploy --stage prod --profile production-ci --dry-run --yes\n' +
        '          bun alchemy deploy --stage prod --profile production-ci --yes',
    );
    expect(alchemyDeploy).not.toContain('--adopt');
    expect(alchemyDeploy).toContain('ALCHEMY_PROFILE: production-ci');
    expect(alchemyDeploy).toContain('CLOUDFLARE_ACCOUNT_ID:');
    expect(alchemyDeploy).toContain('CLOUDFLARE_API_TOKEN:');

    // Two credentialed steps, each also asserting the expected account.
    expect(
      productionWorkflow.match(/(?<!EXPECTED_)CLOUDFLARE_ACCOUNT_ID:/g),
    ).toHaveLength(2);
    expect(
      productionWorkflow.match(/EXPECTED_CLOUDFLARE_ACCOUNT_ID:/g),
    ).toHaveLength(2);
    expect(productionWorkflow.match(/CLOUDFLARE_API_TOKEN:/g)).toHaveLength(2);
    expect(productionWorkflow.match(/ALCHEMY_PROFILE:/g)).toHaveLength(2);
    expect(productionWorkflow).not.toContain('--adopt');
    expect(workflowStep('Smoke test primary domain')).toContain(
      "steps.deploy-revision.outputs.current == 'true'",
    );
    expect(workflowStep('Smoke test alias')).toContain(
      "steps.deploy-revision.outputs.current == 'true'",
    );
    expectWorkflowOrder(
      'Check deployment revision',
      'Build production artifact',
      'Recheck deployment revision',
      'Deploy to Cloudflare with Alchemy',
      'Smoke test primary domain',
      'Smoke test alias',
    );
  });

  test('asserts distinct production and preview account variables before mutation', () => {
    const guardName = 'name: Assert distinct account variables';
    const comparison = 'test "$PRODUCTION_ACCOUNT_ID" != "$PREVIEW_ACCOUNT_ID"';
    const cases = [
      [productionWorkflow, 'Deploy platform to Cloudflare with Alchemy'],
      [
        read('.github/workflows/deploy-playground.yml'),
        'Deploy to Cloudflare with Alchemy',
      ],
    ] as const;
    for (const [workflow, firstCredentialedStep] of cases) {
      expect(workflow).toContain(guardName);
      expect(workflow).toContain(comparison);
      // The check must gate the first credentialed step.
      expect(workflow.indexOf(guardName)).toBeLessThan(
        workflow.indexOf(`- name: ${firstCredentialedStep}`),
      );
    }
  });

  test('deploys the production demo through Alchemy', () => {
    const playground = read('.github/workflows/deploy-playground.yml');
    expect(playground).toContain('group: production-demo');
    const playgroundBuild = namedStep(playground, 'Build production artifact');
    expect(playgroundBuild).not.toMatch(/CLOUDFLARE_|ALCHEMY_PROFILE/);
    const playgroundRecheck = namedStep(
      playground,
      'Recheck deployment revision',
    );
    expect(playgroundRecheck).toContain('id: deploy-revision');
    expect(playgroundRecheck).toContain('bun scripts/latest-green-ci.ts');
    expect(playgroundRecheck).toContain(
      'if [ "$latest_green_sha" = "$DEPLOY_SHA" ]; then',
    );
    const playgroundDeploy = namedStep(
      playground,
      'Deploy to Cloudflare with Alchemy',
    );
    expect(playgroundDeploy).toContain(
      "steps.deploy-revision.outputs.current == 'true'",
    );
    expect(playgroundDeploy).toContain(
      'bun alchemy deploy --stage prod --profile production-ci --yes',
    );
    expect(playgroundDeploy).not.toContain('--adopt');
    expect(playgroundDeploy).toContain('ALCHEMY_PROFILE: production-ci');
    expect(playgroundDeploy).toContain('CLOUDFLARE_ACCOUNT_ID:');
    expect(playgroundDeploy).toContain('CLOUDFLARE_API_TOKEN:');
    expect(playgroundDeploy).toContain(
      [
        'EXPECTED_CLOUDFLARE_ACCOUNT_ID:',
        expression('vars.PRODUCTION_ACCOUNT_ID'),
      ].join(' '),
    );
    expect(namedStep(playground, 'Smoke test production domain')).toContain(
      "steps.deploy-revision.outputs.current == 'true'",
    );
    expectStepOrder(
      playground,
      'Build production artifact',
      'Recheck deployment revision',
      'Deploy to Cloudflare with Alchemy',
      'Smoke test production domain',
    );
  });

  test('tracks the public Turnstile build input in Nx', () => {
    expect(readJson('apps/www/package.json')).toMatchObject({
      nx: {
        targets: {
          build: {
            inputs: expect.arrayContaining([
              { env: 'PUBLIC_TURNSTILE_SITE_KEY' },
              { env: 'PUBLIC_TURNSTILE_ENVIRONMENT' },
            ]),
          },
        },
      },
    });
  });

  test('installs the reviewed beta.83 ownership patch for every deployment', () => {
    for (const path of [
      'apps/www/package.json',
      'apps/docs/package.json',
      'apps/demo/package.json',
      'infra/platform/package.json',
    ]) {
      const manifest = readJson(path) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      expect(
        manifest.dependencies?.alchemy ?? manifest.devDependencies?.alchemy,
      ).toBe('2.0.0-beta.83');
    }
    const root = readJson('package.json') as {
      patchedDependencies?: Record<string, string>;
    };
    const patchPath = 'patches/alchemy@2.0.0-beta.83.patch';
    expect(root.patchedDependencies).toEqual({
      'alchemy@2.0.0-beta.83': patchPath,
    });
    expect(createHash('sha256').update(read(patchPath)).digest('hex')).toBe(
      '256d6c41733f6f55295ee6b28c17328513302a3f7e631e8a179bc60dacf552f1',
    );
    const lockfile = read('bun.lock');
    expect(lockfile).toContain('alchemy@2.0.0-beta.83');
    expect(lockfile).not.toContain('alchemy@2.0.0-beta.81');
    expect(lockfile).toContain(patchPath);
    expect([
      ...new Bun.Glob('patches/alchemy@*.patch').scanSync({
        cwd: workspaceRoot,
      }),
    ]).toEqual([patchPath]);
  });

  test('keeps Worker identities authoritative in Alchemy', () => {
    const www = read('apps/www/infra/Website.ts');
    expect(www).toContain("name: 'www'");
    expect(www).toContain("name: 'maelstrom-ai.co'");
    expect(www).toContain("aliases: ['www.maelstrom-ai.co']");
    expect(www).toContain('workersDev: false');
    const docs = read('apps/docs/infra/Website.ts');
    expect(docs).toContain("name: 'docs'");
    expect(docs).toContain('workersDev: false');
    expect(docs).toContain("domain: 'docs.maelstrom-ai.co'");
    const demo = read('apps/demo/infra/Website.ts');
    expect(demo).toContain("name: 'maelstrom-playground'");
    expect(demo).toContain('workersDev: false');
    expect(demo).toContain("domain: 'demo.maelstrom-ai.co'");
  });

  test('derives Worker bindings from Alchemy and uses date-aligned runtime types', () => {
    expect(readJson('package.json')).toMatchObject({
      catalog: {
        '@cloudflare/workers-types': '5.20260722.1',
      },
    });
    for (const app of ['www', 'demo']) {
      expect(read(`apps/${app}/infra/Website.ts`)).toContain(
        'export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>',
      );
      expect(readJson(`apps/${app}/package.json`)).toMatchObject({
        devDependencies: {
          '@cloudflare/workers-types': 'catalog:',
        },
      });
    }

    const previewWebsite = read('apps/www/infra/PreviewWebsite.ts');
    expect(previewWebsite).toContain(
      'export type PreviewWebsiteEnv = Cloudflare.InferEnv<',
    );
    const wwwEnv = read('apps/www/src/env.d.ts');
    expect(wwwEnv).toContain('PreviewWebsiteEnv');
    expect(wwwEnv).toContain('Omit<WebsiteEnv, keyof PreviewWebsiteEnv>');
    expect(wwwEnv).toContain('RuntimeWebsiteEnvContract');
    expect(wwwEnv).not.toContain('Partial<WebsiteEnv>');
    expect(read('apps/demo/src/env.d.ts')).toContain(
      'interface Env extends WebsiteEnv',
    );
    expect(readJson('apps/docs/package.json')).not.toMatchObject({
      devDependencies: { '@cloudflare/workers-types': expect.any(String) },
    });
  });

  test('keeps Astro adapter build artifacts as declared Nx outputs', () => {
    expect(readJson('apps/www/package.json')).toMatchObject({
      nx: {
        targets: {
          build: {
            outputs: ['{projectRoot}/dist', '{projectRoot}/.wrangler/deploy'],
          },
        },
      },
    });
  });

  test('protects both hosted demo deployment declarations', () => {
    const codeowners = read('.github/CODEOWNERS');
    expect(codeowners).toContain('/apps/demo/infra/Website.ts ');
    expect(codeowners).toContain('/apps/demo/infra/PreviewWebsite.ts ');
    expect(codeowners).toContain('/apps/demo/infra/workerEnv.ts ');
  });

  test('has no direct Wrangler configuration, dependency, generated types, or executable', () => {
    expect(invokesWrangler('wrangler deploy')).toBe(true);
    expect(invokesWrangler('bunx wrangler types')).toBe(true);
    expect(invokesWrangler("'./node_modules/.bin/wrangler' delete")).toBe(true);

    const configPaths = [
      ...new Bun.Glob('wrangler.{json,jsonc,toml}').scanSync({
        cwd: workspaceRoot,
      }),
      ...new Bun.Glob(
        '{apps,infra,packages,tools}/**/wrangler.{json,jsonc,toml}',
      ).scanSync({ cwd: workspaceRoot }),
    ].filter(isRepositorySurface);
    expect(configPaths).toEqual([]);

    const generatedTypePaths = [
      ...new Bun.Glob('worker-configuration.d.ts').scanSync({
        cwd: workspaceRoot,
      }),
      ...new Bun.Glob(
        '{apps,infra,packages,tools}/**/worker-configuration.d.ts',
      ).scanSync({ cwd: workspaceRoot }),
    ].filter(isRepositorySurface);
    expect(generatedTypePaths).toEqual([]);

    const packagePaths = [
      'package.json',
      ...new Bun.Glob('{apps,infra,packages,tools}/*/package.json').scanSync({
        cwd: workspaceRoot,
      }),
    ];
    for (const path of packagePaths) {
      const packageJson = readJson(path) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
        nx?: { targets?: Record<string, unknown> };
      };
      expect(packageJson.dependencies?.wrangler).toBeUndefined();
      expect(packageJson.devDependencies?.wrangler).toBeUndefined();
      expect(packageJson.nx?.targets?.typegen).toBeUndefined();
      expectNoWranglerExecutable([
        ...Object.values(packageJson.scripts ?? {}),
        ...collectCommandFields(packageJson.nx),
      ]);
    }

    const workflowPaths = new Bun.Glob(
      '.github/workflows/*.{yml,yaml}',
    ).scanSync({ cwd: workspaceRoot });
    for (const path of workflowPaths) {
      expectNoWranglerExecutable(collectWorkflowCommands(read(path)));
    }
  });
});
