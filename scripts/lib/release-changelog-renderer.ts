import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import DefaultChangelogRenderer, {
  type ChangelogChange,
} from 'nx/release/changelog-renderer';
import { createProjectGraphAsync } from 'nx/src/project-graph/project-graph';
import { findMatchingProjects } from 'nx/src/utils/find-matching-projects';
import { workspaceRoot } from 'nx/src/utils/workspace-root';

type ChangedFilesForCommit = (commit: string) => readonly string[];
type ReleaseProject = { name: string; root: string };

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
  override async render(): Promise<string> {
    this.changes = scopeChangesToReleaseProjects(
      this.changes,
      await getReleaseProjects(),
      changedFilesForCommit,
    );
    return super.render();
  }
}
