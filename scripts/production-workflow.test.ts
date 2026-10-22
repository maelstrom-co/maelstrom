import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
