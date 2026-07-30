import type { Config } from './config.ts';

export function readConfig(): Config {
  return {
    token: requireEnv('GITHUB_TOKEN'),
    repository: requireEnv('REPOSITORY'),
    prNumber: requireEnv('PR_NUMBER'),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}
