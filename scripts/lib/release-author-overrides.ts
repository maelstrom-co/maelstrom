import { execFileSync } from 'node:child_process';
import { workspaceRoot } from 'nx/src/utils/workspace-root';

type AuthorIdentity = { name: string; email: string };
type AuthorCorrection = {
  expectedAuthor: AuthorIdentity;
  correctedAuthor: AuthorIdentity & { username: string };
};

const nachoCorrection: AuthorCorrection = {
  expectedAuthor: { name: 'Nacho Vazquez', email: 'xppcoder@gmail.com' },
  correctedAuthor: {
    name: 'Nacho Vazquez',
    email: 'nacho@naxo.dev',
    username: 'NachoVazquez',
  },
};

// Evidence for these mixed squash identities is in docs/research/github-squash-author-attribution.md.
const releaseAuthorOverrides = new Map<string, AuthorCorrection>([
  ['bd29917d32a6bed291d28c20c0e5abee3a2a65e2', nachoCorrection],
  ['21e9f07ceaf98b3326eedf559a08c5c72d265914', nachoCorrection],
  ['135ced15cfaa7391a3cb6570620ba261f1a0221b', nachoCorrection],
]);

function resolveFullCommitHash(hash: string): string | undefined {
  for (const [command, args] of [
    ['git', ['rev-parse', '--verify', '--end-of-options', `${hash}^{commit}`]],
    ['jj', ['log', '-r', hash, '--no-graph', '-T', 'commit_id']],
  ] as const) {
    try {
      const resolved = execFileSync(command, args, {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (/^[a-f0-9]{40}$/.test(resolved)) return resolved;
    } catch {
      // Try the other supported VCS before declining the correction.
    }
  }
  return undefined;
}

/** Corrects documented squash identities only on their original commits. */
export function findReleaseAuthorOverride(
  hash: string | undefined,
  author: AuthorIdentity,
): AuthorCorrection['correctedAuthor'] | undefined {
  if (!hash || !/^[a-f0-9]{7,40}$/.test(hash)) return undefined;
  const candidate = [...releaseAuthorOverrides].find(
    ([commit, correction]) =>
      commit.startsWith(hash) &&
      correction.expectedAuthor.name === author.name &&
      correction.expectedAuthor.email === author.email,
  );
  if (!candidate) return undefined;

  const fullHash = hash.length === 40 ? hash : resolveFullCommitHash(hash);
  if (fullHash !== candidate[0]) return undefined;
  return candidate[1].correctedAuthor;
}
