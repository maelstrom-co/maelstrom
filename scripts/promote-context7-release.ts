import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  snapshotTarget,
  assertFixtureMatchesSelector,
  type SnapshotSelector,
} from '../apps/docs/src/lib/docs-snapshot-target';
import { PACKED_PACKAGE_NAMES } from './lib/packed-manifest';

export async function selectSnapshot(
  config: SnapshotSelector,
  verifiedVersion: string | undefined,
  latestVersions: readonly string[],
  hasReference: (folder: string) => Promise<boolean>,
  previous: SnapshotSelector = config,
) {
  const [latest] = latestVersions;
  if (
    !latest ||
    latestVersions.length !== PACKED_PACKAGE_NAMES.length ||
    !latestVersions.every((version) => version === latest)
  ) {
    throw new Error('The public SDK packages must agree on npm latest.');
  }
  const target = snapshotTarget(latest);
  if (target.kind !== 'folder')
    throw new Error('npm latest must be a stable SDK release.');
  if (verifiedVersion && verifiedVersion !== latest) {
    if (
      snapshotTarget(verifiedVersion).kind === 'folder' &&
      Bun.semver.order(latest, verifiedVersion) > 0
    )
      return { action: 'skip' as const };
    throw new Error(
      `Verified release ${verifiedVersion} does not match npm latest ${latest}.`,
    );
  }
  // Compare against the PR base as well as the current selector during publication recovery.
  for (const path of previous.folders ?? []) {
    const prior = /^apps\/docs\/src\/content\/docs\/(0\.\d+|[1-9]\d*)$/.exec(
      path,
    )?.[1];
    if (
      prior &&
      Bun.semver.order(
        prior.startsWith('0.') ? prior + '.0' : prior + '.0.0',
        latest,
      ) > 0
    ) {
      throw new Error(
        'Refusing to roll back the selected release line ' + prior,
      );
    }
  }
  const folder = 'apps/docs/src/content/docs/' + target.folder;
  const selected =
    config.branch === 'main' &&
    config.folders?.length === 1 &&
    config.folders[0] === folder;
  const ready = await hasReference(folder);
  if (verifiedVersion && !selected)
    return {
      action: 'propose' as const,
      config: { ...config, branch: 'main', folders: [folder] },
      folder,
      ready,
      latest,
    };
  if (!selected)
    throw new Error(
      `Context7 must index only ${folder} on main for npm latest ${latest}.`,
    );
  if (!ready)
    throw new Error(
      `Missing frozen guides or generated React API reference in ${folder}.`,
    );
  return { action: 'refresh' as const };
}

async function npmLatest(name: string): Promise<string> {
  const response = await fetch(
    'https://registry.npmjs.org/' + encodeURIComponent(name) + '/latest',
    { signal: AbortSignal.timeout(15_000), redirect: 'error' },
  );
  if (!response.ok)
    throw new Error(`npm lookup failed for ${name}: HTTP ${response.status}`);
  const data = (await response.json()) as { name?: string; version?: string };
  if (data.name !== name || !data.version)
    throw new Error('Invalid registry metadata for ' + name);
  return data.version;
}

if (import.meta.main) {
  const {
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
    RUNNER_TEMP: temp,
    VERIFIED_VERSION: release,
  } = process.env;
  if (!output || !summary || !temp)
    throw new Error('Missing Actions output paths.');
  const config = await Bun.file('context7.json').json();
  const previous =
    process.env.GITHUB_EVENT_NAME === 'pull_request'
      ? await Bun.file(join(temp, 'context7-base.json')).json()
      : config;
  const result = await selectSnapshot(
    config,
    release,
    await Promise.all(PACKED_PACKAGE_NAMES.map(npmLatest)),
    async (folder) =>
      (await Bun.file(
        join(folder, 'getting-started/quick-start.mdx'),
      ).exists()) &&
      (await Bun.file(join(folder, 'reference/react/README.md')).exists()),
    previous,
  );
  if (result.action === 'refresh') {
    const fixture = await Bun.file(
      'apps/docs/tools/skills/published-examples/package.json.template',
    ).json();
    assertFixtureMatchesSelector(
      fixture.dependencies['@maelstrom-co/react'],
      config,
    );
  }
  appendFileSync(output, `action=${result.action}\n`);
  if (result.action === 'propose') {
    await Bun.write(
      join(temp, 'context7.json'),
      JSON.stringify(result.config, null, 2) + '\n',
    );
    appendFileSync(
      summary,
      `npm latest is ${result.latest}. Download the **context7-selector** artifact. Open a PR to main with its context7.json at the repository root.\n\n${result.ready ? 'The frozen guide and React reference are present.' : 'Include the frozen guides and TypeDoc reference built from v' + result.latest + ' in ' + result.folder + '.'} Update the published-example fixture and its lockfile to the selected SDK line. Merging the selector triggers a refresh.\n`,
    );
  }
}
