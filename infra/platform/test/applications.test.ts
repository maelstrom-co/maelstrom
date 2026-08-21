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

describe('application infrastructure contract', () => {
  test('gives each independently deployed app its own composition root', () => {
    expect(read('apps/www/alchemy.run.ts')).toContain("'MaelstromWww'");
    expect(read('apps/docs/alchemy.run.ts')).toContain("'MaelstromDocs'");
    expect(read('apps/demo/alchemy.run.ts')).toContain("'MaelstromDemo'");
  });

  test('keeps adoption policy out of deployment declarations', () => {
    expect(
      deploymentSourcePaths.filter((path) => read(path).includes('adopt(')),
    ).toEqual([]);
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
    expect(website).toMatch(/Cloudflare\.Worker\(\s*'Website'/);
    expect(website).toContain("className: 'SessionDO'");
    expect(website).toContain("runWorkerFirst: ['/ws']");
    expect(readJson('apps/demo/wrangler.jsonc')).toMatchObject({
      name: 'maelstrom-playground',
      main: 'src/worker/index.ts',
      durable_objects: {
        bindings: [{ name: 'SESSION_DO', class_name: 'SessionDO' }],
      },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['SessionDO'] }],
    });
    expect(readJson('apps/demo/package.json')).toMatchObject({
      nx: {
        targets: {
          deploy: {
            options: { command: 'alchemy deploy --stage prod' },
          },
        },
      },
    });
  });

  test('keeps production builds credential-free and deploys every app through Alchemy', () => {
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
    expect(build).not.toMatch(/CLOUDFLARE_|ALCHEMY_PROFILE/);

    const recheck = workflowStep('Recheck deployment revision');
    expect(recheck).toContain('id: deploy-revision');
    expect(recheck).toContain('bun scripts/latest-green-ci.ts');
    expect(recheck).toContain(
      'if [ "$latest_green_sha" = "$DEPLOY_SHA" ]; then',
    );

    const alchemyDeploy = workflowStep('Deploy to Cloudflare with Alchemy');
    expect(alchemyDeploy).toContain(
      'bun alchemy deploy --stage prod --profile production-ci --yes',
    );
    expect(alchemyDeploy).not.toContain('--adopt');
    expect(alchemyDeploy).toContain('ALCHEMY_PROFILE: production-ci');
    expect(alchemyDeploy).toContain('CLOUDFLARE_ACCOUNT_ID:');
    expect(alchemyDeploy).toContain('CLOUDFLARE_API_TOKEN:');

    expect(productionWorkflow).not.toContain('wrangler deploy');
    expect(productionWorkflow.match(/CLOUDFLARE_ACCOUNT_ID:/g)).toHaveLength(1);
    expect(productionWorkflow.match(/CLOUDFLARE_API_TOKEN:/g)).toHaveLength(1);
    expect(productionWorkflow.match(/ALCHEMY_PROFILE:/g)).toHaveLength(1);
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

  test('deploys docs previews through Alchemy while other previews remain on Wrangler', () => {
    const previews = read('.github/workflows/deploy-preview.yml');
    const teardown = section(previews, '  teardown:\n', '\n<end>');
    expect(previews.match(/cloudflare\/wrangler-action@/g)).toHaveLength(2);
    expect(previews).toContain('Deploy www to Cloudflare');
    expect(previews).toContain('Deploy demo to Cloudflare');
    const docsPreviewDeploy = namedStep(
      previews,
      'Deploy docs to Cloudflare with Alchemy',
    );
    expect(docsPreviewDeploy).toContain(
      'bun alchemy deploy alchemy.preview.run.ts',
    );
    expect(docsPreviewDeploy).not.toContain('--adopt');
    expect(docsPreviewDeploy).toContain('ALCHEMY_PROFILE: preview-ci');
    expect(docsPreviewDeploy).toContain('CLOUDFLARE_PREVIEW_ACCOUNT_ID');
    expect(docsPreviewDeploy).toContain('CLOUDFLARE_PREVIEW_API_TOKEN');
    expect(docsPreviewDeploy).toContain('--stack MaelstromDocsPreview');
    expect(docsPreviewDeploy).toContain('deployment-url=%s');
    expect(previews).toContain(
      `| Documentation | ${'$'}{{ steps.deploy-docs.outputs.deployment-url }} |`,
    );

    const independentBuild = namedStep(
      previews,
      'Build independent preview artifacts',
    );
    expect(independentBuild).not.toMatch(/CLOUDFLARE_|ALCHEMY_PROFILE/);

    const docsPreviewDestroy = namedStep(
      teardown,
      'Destroy docs preview with Alchemy',
    );
    expect(docsPreviewDestroy).toContain(
      'bun alchemy destroy alchemy.preview.run.ts',
    );
    expect(docsPreviewDestroy).toContain('id: destroy-docs');
    expect(docsPreviewDestroy).toContain('ALCHEMY_PROFILE: preview-ci');
    expect(previews).toContain('Checkout trusted teardown code');
    const legacyPreviewDestroy = namedStep(teardown, 'Delete preview Workers');
    expect(legacyPreviewDestroy).toContain('id: delete-workers');
    expect(legacyPreviewDestroy).toContain('if: always()');
    expect(legacyPreviewDestroy).toContain(
      '"maelstrom-docs-alchemy-pr-$PR_NUMBER"',
    );
    expect(namedStep(teardown, 'Find existing preview comment')).toContain(
      'if: always()',
    );
    expect(teardown).toContain('Mark incomplete preview teardown');

    const playground = read('.github/workflows/deploy-playground.yml');
    expect(playground).toContain('group: production-demo');
    expect(playground).not.toContain('wrangler deploy');
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

  test('installs the reviewed Alchemy ownership patch', () => {
    expect(readJson('package.json')).toMatchObject({
      patchedDependencies: {
        'alchemy@2.0.0-beta.72': 'patches/alchemy@2.0.0-beta.72.patch',
      },
    });
    const lockfile = read('bun.lock');
    expect(lockfile).toContain(
      '"alchemy@2.0.0-beta.72": "patches/alchemy@2.0.0-beta.72.patch"',
    );

    const patch = read('patches/alchemy@2.0.0-beta.72.patch');
    expect(createHash('sha256').update(patch).digest('hex')).toBe(
      '78c94e51c3d348164cf79d011ceea30ee8ef3bcfbe3908572b938df11d7f5045',
    );
    expect(patch).toContain('resolveReadProps: resolveWorkerReadProps');
    expect(patch).toContain('provider.resolveReadProps?.(news)');
    expect(patch).toContain(
      'Option.isSome(readProps) && !isResolved(readProps.value)',
    );
    expect(patch).toContain('olds: readProps.value');
  });

  test('keeps Alchemy Worker identities aligned with Wrangler configuration', () => {
    const www = read('apps/www/infra/Website.ts');
    expect(www).toContain("name: 'www'");
    expect(www).toContain("name: 'maelstrom-ai.co'");
    expect(www).toContain("aliases: ['www.maelstrom-ai.co']");
    expect(readJson('apps/www/wrangler.jsonc')).toMatchObject({
      name: 'www',
      routes: [
        { pattern: 'maelstrom-ai.co', custom_domain: true },
        { pattern: 'www.maelstrom-ai.co', custom_domain: true },
      ],
    });
    const docs = read('apps/docs/infra/Website.ts');
    expect(docs).toContain("name: 'docs'");
    expect(docs).toContain("domain: 'docs.maelstrom-ai.co'");
    expect(readJson('apps/docs/wrangler.json')).toMatchObject({
      name: 'docs',
      routes: [{ pattern: 'docs.maelstrom-ai.co', custom_domain: true }],
    });
    const demo = read('apps/demo/infra/Website.ts');
    expect(demo).toContain("name: 'maelstrom-playground'");
    expect(demo).toContain("domain: 'demo.maelstrom-ai.co'");
    expect(readJson('apps/demo/wrangler.jsonc')).toMatchObject({
      name: 'maelstrom-playground',
      routes: [{ pattern: 'demo.maelstrom-ai.co', custom_domain: true }],
    });
  });
});
