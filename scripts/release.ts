import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { releaseChangelog, releaseVersion } from 'nx/release';
import { createProjectGraphAsync } from 'nx/src/project-graph/project-graph';
import {
  gitCommit,
  gitPush,
  gitTag,
  getCommitHash,
} from 'nx/src/command-line/release/utils/git';
import {
  createCommitMessageValues,
  createGitTagValues,
  handleDuplicateGitTags,
} from 'nx/src/command-line/release/utils/shared';
import { createRemoteReleaseClient } from 'nx/src/command-line/release/utils/remote-release-clients/remote-release-client';

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    'dry-run': { type: 'boolean', short: 'd', default: false },
    verbose: { type: 'boolean', default: false },
    'skip-publish': { type: 'boolean', default: false },
    'first-release': { type: 'boolean', default: false },
    preid: { type: 'string' },
  },
});

const dryRun = values['dry-run'] ?? false;
const verbose = values.verbose ?? false;
const firstRelease = values['first-release'] ?? false;
const preid = values.preid;

// Step 1: Version — bump package.json files, stage only (no commit/tag)
const { workspaceVersion, projectsVersionData, releaseGraph } =
  await releaseVersion({
    specifier: values.version,
    preid,
    firstRelease,
    dryRun,
    verbose,
    stageChanges: true,
    gitCommit: false,
    gitTag: false,
  });

// Step 2: Changelog — generate changelog content, stage only (no commit/tag/push/release)
const changelogResult = await releaseChangelog({
  releaseGraph,
  versionData: projectsVersionData,
  version: workspaceVersion,
  firstRelease,
  dryRun,
  verbose,
  stageChanges: true,
  gitCommit: false,
  gitTag: false,
  gitPush: false,
  createRelease: false,
});

// Step 3: Commit all staged changes
const commitMessage = 'chore(release): {version}';
const commitMessageValues = createCommitMessageValues(
  releaseGraph.releaseGroups,
  releaseGraph.releaseGroupToFilteredProjects,
  projectsVersionData,
  commitMessage,
);
await gitCommit({
  messages: commitMessageValues,
  additionalArgs: '',
  dryRun,
  verbose,
});

// Step 4: Tag the commit
const gitTagValues = createGitTagValues(
  releaseGraph.releaseGroups,
  releaseGraph.releaseGroupToFilteredProjects,
  projectsVersionData,
);
handleDuplicateGitTags(gitTagValues);
for (const tag of gitTagValues) {
  await gitTag({
    tag,
    message: '',
    additionalArgs: '',
    dryRun,
    verbose,
  });
}

// Step 5: Push to remote (required for GitHub release)
await gitPush({
  dryRun,
  verbose,
  additionalArgs: '',
});

// Step 6: Create GitHub release
if (changelogResult.workspaceChangelog) {
  const remoteReleaseClient = await createRemoteReleaseClient({
    provider: 'github',
    hostname: 'github.com',
    apiBaseUrl: 'https://api.github.com',
  });
  const latestCommit = await getCommitHash('HEAD');
  await remoteReleaseClient.createOrUpdateRelease(
    changelogResult.workspaceChangelog.releaseVersion,
    changelogResult.workspaceChangelog.contents,
    latestCommit,
    { dryRun },
  );
}

if (values['skip-publish']) {
  console.log('Skipping publish.');
  process.exit(0);
}

// Step 7: Publish each non-private project directly with `npm publish`.
// We bypass Nx's `releasePublish` because its dist-tag pre-check runs
// `npm view <pkg> versions dist-tags --json` against the registry; GitHub
// Packages returns a manifest with an empty `_id`, npm 10.x silently emits
// no output for that, and Nx then `JSON.parse('')` throws "Unexpected EOF".
const npmTag = preid ?? 'latest';
const registry =
  process.env.RELEASE_REGISTRY ?? 'https://npm.pkg.github.com';
const projectGraph = await createProjectGraphAsync();
const failures: string[] = [];

for (const [, projectNames] of releaseGraph.releaseGroupToFilteredProjects) {
  for (const projectName of projectNames) {
    const projectNode = projectGraph.nodes[projectName];
    if (!projectNode) {
      console.warn(`Skipping ${projectName} (not in project graph).`);
      continue;
    }
    const projectRoot = projectNode.data.root;
    const pkgJsonPath = join(process.cwd(), projectRoot, 'package.json');
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      name: string;
      version: string;
      private?: boolean;
    };
    if (pkgJson.private === true) {
      console.log(`Skipping ${pkgJson.name} (private).`);
      continue;
    }
    const args = ['publish', '--tag', npmTag, '--registry', registry];
    if (dryRun) args.push('--dry-run');
    console.log(
      `\n→ ${pkgJson.name}@${pkgJson.version} → ${registry} [tag=${npmTag}]${
        dryRun ? ' (dry-run)' : ''
      }`,
    );
    try {
      execSync(`npm ${args.join(' ')}`, {
        cwd: join(process.cwd(), projectRoot),
        stdio: verbose ? 'inherit' : ['ignore', 'inherit', 'inherit'],
      });
    } catch {
      failures.push(pkgJson.name);
    }
  }
}

if (failures.length > 0) {
  console.error(`\nPublish failed for: ${failures.join(', ')}`);
  process.exit(1);
}
