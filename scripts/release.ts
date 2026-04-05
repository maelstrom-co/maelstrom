import { parseArgs } from 'node:util';
import {
  releaseChangelog,
  releasePublish,
  releaseVersion,
} from 'nx/release';
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

const publishResults = await releasePublish({
  releaseGraph,
  firstRelease,
  dryRun,
  verbose,
});

process.exit(
  Object.values(publishResults).every((result) => result.code === 0) ? 0 : 1,
);
