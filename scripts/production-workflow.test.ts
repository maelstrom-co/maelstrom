import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const expression = (value: string) => ['$', `{{ ${value} }}`].join('');

test('supplies public GitHub metadata without giving application builds an identity', () => {
  const workflow = Bun.YAML.parse(
    readFileSync(
      resolve(import.meta.dir, '../.github/workflows/deploy-production.yml'),
      'utf8',
    ),
  ) as {
    permissions: Record<string, string>;
    env?: Record<string, string>;
    jobs: {
      deploy: {
        env?: Record<string, string>;
        permissions?: Record<string, string>;
        steps: {
          id?: string;
          name?: string;
          if?: string;
          run?: string;
          env?: Record<string, string>;
        }[];
      };
    };
  };
  const job = workflow.jobs.deploy;
  const metadataIndex = job.steps.findIndex(
    (step) => step.id === 'github-stars',
  );
  const buildIndex = job.steps.findIndex(
    (step) => step.name === 'Build production artifact',
  );
  expect(metadataIndex).toBeGreaterThanOrEqual(0);
  expect(metadataIndex).toBeLessThan(buildIndex);
  const metadata = job.steps[metadataIndex]!;
  const build = job.steps[buildIndex]!;
  expect(metadata.if).toContain("matrix.app == 'www'");
  expect(metadata.env?.GH_TOKEN).toBe(expression('github.token'));
  expect(metadata.run).toContain('gh api');
  expect(metadata.run).not.toMatch(
    /GH_TOKEN|GITHUB_ENV|bun install|nx .*build|apps\/www/,
  );
  expect(build.env?.PUBLIC_GITHUB_STAR_COUNT).toBe(
    expression('steps.github-stars.outputs.count'),
  );
  for (const env of [workflow.env, job.env, build.env]) {
    expect(JSON.stringify(env ?? {})).not.toMatch(
      /github\.token|secrets\.|GH_TOKEN|GITHUB_TOKEN|CLOUDFLARE_API_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN|ALCHEMY_PROFILE/,
    );
  }
  for (const permissions of [workflow.permissions, job.permissions]) {
    expect(Object.values(permissions ?? {})).not.toContain('write');
  }
});

test('keeps optional star metadata from blocking a production build', async () => {
  const workflow = Bun.YAML.parse(
    readFileSync(
      resolve(import.meta.dir, '../.github/workflows/deploy-production.yml'),
      'utf8',
    ),
  ) as { jobs: { deploy: { steps: { id?: string; run?: string }[] } } };
  const command = workflow.jobs.deploy.steps.find(
    (step) => step.id === 'github-stars',
  )?.run;
  expect(command).toBeDefined();
  const directory = await mkdtemp(join(tmpdir(), 'maelstrom-stars-'));
  try {
    for (const mode of ['success', 'unavailable', 'invalid']) {
      const output = join(directory, `${mode}.txt`);
      const child = Bun.spawn(['bash', '-c', command!], {
        env: {
          PATH: [
            resolve(import.meta.dir, 'fixtures/github-stars'),
            process.env.PATH ?? '',
          ].join(delimiter),
          GH_TOKEN: 'fixture',
          GITHUB_REPOSITORY: 'fixture/ci',
          GITHUB_OUTPUT: output,
          STAR_LOOKUP_FIXTURE: mode,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code).toBe(0);
      expect(`${stdout}${stderr}`).not.toContain('do-not-log-response');
      expect(`${stdout}${stderr}`).not.toContain('Bearer fixture');
      const count = (await Bun.file(output).exists())
        ? await Bun.file(output).text()
        : '';
      expect(count).toBe(mode === 'success' ? 'count=0\n' : '');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
