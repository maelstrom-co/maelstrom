import type { Config } from './config.ts';

export function readConfig(): Config {
  const repository = requireEnv('REPOSITORY');
  return {
    token: requireEnv('GITHUB_TOKEN'),
    repository,
    prNumber: requireEnv('PR_NUMBER'),
    isFork: headIsFork(repository),
  };
}

// Deliberately not `requireEnv`: `head.repo.full_name` is null once a fork has
// been deleted, and reaches us as an empty string. That is an unknown
// provenance, which must not open the bot exemption — an empty head already
// compares unequal, so failing closed needs no arm of its own. Compared
// case-insensitively because GitHub owner and repository names are, and a
// case-only difference would otherwise strip the exemption from this repo's own
// Dependabot branches.
function headIsFork(repository: string): boolean {
  const head = process.env.HEAD_REPOSITORY ?? '';
  return head.toLowerCase() !== repository.toLowerCase();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}
