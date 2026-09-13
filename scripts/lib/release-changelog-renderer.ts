import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import DefaultChangelogRenderer, {
  type ChangelogChange,
} from 'nx/release/changelog-renderer';
import { createProjectGraphAsync } from 'nx/src/project-graph/project-graph';
import { findMatchingProjects } from 'nx/src/utils/find-matching-projects';
import { workspaceRoot } from 'nx/src/utils/workspace-root';
import { findReleaseAuthorOverride } from './release-author-overrides.ts';

type ChangedFilesForCommit = (commit: string) => readonly string[];
type ReleaseProject = { name: string; root: string };
type CommitAuthor = { name: string; email: string; username: string };
const execFileAsync = promisify(execFile);

export function scopeChangesToReleaseProjects(
  changes: readonly ChangelogChange[],
  releaseProjects: readonly ReleaseProject[],
  changedFilesForCommit: ChangedFilesForCommit,
): ChangelogChange[] {
  return changes.flatMap((change) => {
    // Version-plan changes have no backing commit. Nx has already scoped them
    // to the release group, so there is no commit path to inspect.
    if (!change.shortHash) return [change];

    const changedFiles = changedFilesForCommit(change.shortHash);
    const affectedProjects = releaseProjects.filter(({ root }) =>
      changedFiles.some((file) => file === root || file.startsWith(`${root}/`)),
    );
    if (affectedProjects.length === 0) return [];

    // A commit may span an app and one package while retaining an app scope.
    // Name the package in release notes when its ownership is unambiguous.
    return [
      {
        ...change,
        affectedProjects: affectedProjects.map(({ name }) => name),
        scope:
          affectedProjects.length === 1
            ? (affectedProjects[0].name.split('/').at(-1) ?? change.scope)
            : change.scope,
      },
    ];
  });
}

function changedFilesForCommit(commit: string): string[] {
  return execFileSync(
    'git',
    [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-only',
      '-r',
      commit,
      '--',
      'packages',
    ],
    { cwd: workspaceRoot, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);
}

async function getReleaseProjects(): Promise<ReleaseProject[]> {
  let nxJson: { release?: { projects?: string | string[] } };
  try {
    nxJson = JSON.parse(
      readFileSync(join(workspaceRoot, 'nx.json'), 'utf8'),
    ) as typeof nxJson;
  } catch (error) {
    throw new Error('Could not read release.projects from nx.json.', {
      cause: error,
    });
  }
  const configuredProjects = nxJson.release?.projects;
  if (!configuredProjects) {
    throw new Error(
      'The release changelog renderer requires release.projects in nx.json.',
    );
  }

  const projectGraph = await createProjectGraphAsync();
  const projectNames = findMatchingProjects(
    Array.isArray(configuredProjects)
      ? configuredProjects
      : [configuredProjects],
    projectGraph.nodes,
  );
  return projectNames.map((name) => ({
    name,
    root: projectGraph.nodes[name].data.root,
  }));
}

/** Keeps workspace release notes within the same project boundary as Nx Release. */
export default class ReleaseChangelogRenderer extends DefaultChangelogRenderer {
  protected async getCommitAuthor(hash: string): Promise<CommitAuthor | null> {
    const remote = this.remoteReleaseClient.getRemoteRepoData();
    if (
      !remote ||
      this.remoteReleaseClient.remoteReleaseProviderName !== 'GitHub'
    ) {
      return null;
    }
    try {
      const { stdout } = await execFileAsync(
        'gh',
        [
          'api',
          '--hostname',
          remote.hostname,
          `repos/${remote.slug}/commits/${encodeURIComponent(hash)}`,
          '--jq',
          '{name: .commit.author.name, email: .commit.author.email, username: .author.login}',
        ],
        { cwd: workspaceRoot, encoding: 'utf8', timeout: 10_000 },
      );
      const author = JSON.parse(stdout);
      if (
        typeof author?.name === 'string' &&
        typeof author.email === 'string' &&
        typeof author.username === 'string'
      ) {
        return author;
      }
    } catch {
      // Missing credentials, unpushed commits, and API failures leave plain names.
    }
    return null;
  }

  protected override async renderAuthors(): Promise<string[]> {
    const authors = new Map<
      string,
      Map<string, { name: string; hashes: Set<string>; usernames: Set<string> }>
    >();
    for (const change of [
      ...this.relevantChanges,
      ...this.additionalChangesForAuthorsSection,
    ]) {
      for (const author of change.authors ?? []) {
        const correction = findReleaseAuthorOverride(change.shortHash, author);
        const correctedAuthor = correction ?? author;
        const name = this.formatName(correctedAuthor.name);
        if (!name || name.includes('[bot]')) continue;
        let identities = authors.get(name);
        if (!identities) {
          identities = new Map();
          authors.set(name, identities);
        }
        let identity = identities.get(correctedAuthor.email);
        if (!identity) {
          identity = {
            name: correctedAuthor.name,
            hashes: new Set(),
            usernames: new Set(),
          };
          identities.set(correctedAuthor.email, identity);
        }
        if (correction) identity.usernames.add(correction.username);
        else if (change.shortHash) identity.hashes.add(change.shortHash);
      }
    }
    if (authors.size === 0) return [];

    const commits = new Map<string, Promise<CommitAuthor | null>>();
    const lines = ['', '### ❤️ Thank You', ''];
    for (const [name, identities] of [...authors].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const usernames = new Set<string>();
      let resolvedIdentities = 0;
      if (this.changelogRenderOptions.applyUsernameToAuthors) {
        for (const [email, identity] of identities) {
          if (identity.usernames.size > 0) {
            for (const username of identity.usernames) usernames.add(username);
            resolvedIdentities++;
            continue;
          }
          for (const hash of identity.hashes) {
            let pending = commits.get(hash);
            if (!pending) {
              pending = this.getCommitAuthor(hash);
              commits.set(hash, pending);
            }
            const author = await pending;
            // A commit's linked account belongs to its primary author, not its co-authors.
            if (author?.name === identity.name && author.email === email) {
              usernames.add(author.username);
              resolvedIdentities++;
              break;
            }
          }
        }
      }
      const username =
        resolvedIdentities === identities.size && usernames.size === 1
          ? [...usernames][0]
          : undefined;
      lines.push(`- ${name}${username ? ` @${username}` : ''}`);
    }
    return lines;
  }

  override async render(): Promise<string> {
    this.changes = scopeChangesToReleaseProjects(
      this.changes,
      await getReleaseProjects(),
      changedFilesForCommit,
    );
    return super.render();
  }
}
