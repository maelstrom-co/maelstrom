import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { assertFixtureMatchesSelector } from '../apps/docs/src/lib/docs-snapshot-target';
import { PACKED_PACKAGE_NAMES } from './lib/packed-manifest';
import { selectSnapshot } from './promote-context7-release';

const config = {
  url: 'https://context7.com/maelstrom-co/maelstrom',
  branch: 'main',
  folders: ['apps/docs/src/content/docs/0.2'],
};
const tags = (v: string) => PACKED_PACKAGE_NAMES.map(() => v);
const ready = async () => true;
test('a verified patch refreshes the same frozen release line', async () => {
  expect(
    await selectSnapshot(
      config,
      '0.2.2',
      tags('0.2.2'),
      async (folder) => folder === config.folders[0],
    ),
  ).toEqual({ action: 'refresh' });
});
test('a new release prepares one selector and preserves the library identity', async () => {
  for (const [v, line] of [
    ['0.3.0', '0.3'],
    ['1.2.1', '1'],
  ]) {
    const folder = 'apps/docs/src/content/docs/' + line;
    expect(await selectSnapshot(config, v, tags(v), async () => false)).toEqual(
      {
        action: 'propose',
        folder,
        ready: false,
        latest: v,
        config: { ...config, folders: [folder] },
      },
    );
  }
});
test('manual and PR validation reject stale, development, or mixed selectors', async () => {
  for (const folders of [
    [],
    ['apps/docs/src/content/docs/dev'],
    [...config.folders, 'apps/docs/src/content/docs/dev'],
  ]) {
    await expect(
      selectSnapshot({ ...config, folders }, undefined, tags('0.2.1'), ready),
    ).rejects.toThrow('must index only');
  }
  await expect(
    selectSnapshot(config, undefined, tags('0.3.0'), ready),
  ).rejects.toThrow('must index only');
  await expect(
    selectSnapshot(
      { ...config, branch: 'stable' },
      undefined,
      tags('0.2.1'),
      ready,
    ),
  ).rejects.toThrow('must index only');
});
test('an unpublished release, prerelease, missing snapshot or partial publication cannot request indexing', async () => {
  await expect(
    selectSnapshot(config, '0.3.0', tags('0.2.1'), ready),
  ).rejects.toThrow('does not match');
  await expect(
    selectSnapshot(config, '0.3.0-latest.1', tags('0.3.0-latest.1'), ready),
  ).rejects.toThrow('stable SDK');
  await expect(
    selectSnapshot(config, '0.2.1', tags('0.2.1'), async () => false),
  ).rejects.toThrow('Missing frozen');
  const mixed = tags('0.3.0');
  mixed[0] = '0.2.1';
  await expect(selectSnapshot(config, '0.3.0', mixed, ready)).rejects.toThrow(
    'must agree',
  );
});
test('a recovery of an old stable release cannot select an older snapshot', async () => {
  expect(await selectSnapshot(config, '0.2.1', tags('0.3.0'), ready)).toEqual({
    action: 'skip',
  });
});
test('only verified publication or approved main content can submit a refresh', () => {
  type Workflow = {
    permissions: Record<string, string>;
    jobs: Record<
      string,
      {
        steps: { name?: string }[];
        needs: string | string[];
        if: string;
        with: Record<string, string>;
        permissions: Record<string, string>;
      }
    >;
    on: { push: { branches: string[]; paths: string[] } };
  };
  const yaml = (name: string) =>
    Bun.YAML.parse(
      readFileSync(
        new URL('../.github/workflows/' + name + '.yml', import.meta.url),
        'utf8',
      ),
    );
  const release = yaml('release') as Workflow,
    workflow = yaml('context7-refresh') as Workflow;
  const job = release.jobs['refresh-released-docs'];
  expect(release.jobs.publish.steps.at(-1)?.name).toBe(
    'Verify packages are live',
  );
  expect(job.needs).toEqual(['prepare', 'publish']);
  expect(job.if).toBe(
    "needs.prepare.outputs.dry_run == 'false' && needs.prepare.outputs.dist_tag == 'latest'",
  );
  expect(job.with.verified_version).toBe(
    '$' + '{{ needs.prepare.outputs.version }}',
  );
  expect(job.permissions).toEqual({ contents: 'read' });
  expect(workflow.on.push.branches).toEqual(['main']);
  expect(workflow.on.push.paths).toContain(
    '!apps/docs/src/content/docs/dev/**',
  );
  expect(workflow.jobs.refresh.if).toBe(
    "github.event_name != 'pull_request' && needs.select.outputs.action == 'refresh'",
  );
  expect(workflow.permissions).toEqual({});
});

test('neither publication recovery nor a selector PR can move the default backward after a registry retag', async () => {
  const newer = { ...config, folders: ['apps/docs/src/content/docs/0.3'] };
  await expect(
    selectSnapshot(newer, '0.2.1', tags('0.2.1'), ready),
  ).rejects.toThrow('roll back');
  await expect(
    selectSnapshot(config, undefined, tags('0.2.1'), ready, newer),
  ).rejects.toThrow('roll back');
});

test('a new default line must compile its own frozen Quick Start against a matching published fixture', () => {
  const newer = { ...config, folders: ['apps/docs/src/content/docs/0.3'] };
  expect(() => assertFixtureMatchesSelector('0.2.1', newer)).toThrow('fixture');
  expect(assertFixtureMatchesSelector('0.3.1', newer)).toBe('0.3');
});
