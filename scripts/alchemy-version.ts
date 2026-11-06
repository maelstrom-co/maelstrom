import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** These directories resolve independent Alchemy installations in this workspace. */
export const alchemyProjects = [
  'infra/platform',
  'apps/demo',
  'apps/www',
  'apps/docs',
] as const;

/** Checks installed packages before a caller receives permission to use a shared store. */
export function assertAlchemyVersion(
  root: string,
  required: string | undefined,
  project: string = 'infra/platform',
) {
  if (!required) return;
  if (!/^2\.0\.0-beta\.\d+$/.test(required))
    throw new Error('ALCHEMY_REQUIRED_VERSION must be an exact beta version');
  const packages = ['alchemy'];
  if (Number(required.split('.').at(-1)) >= 84)
    packages.push('@alchemy.run/cloudflare');
  for (const name of packages) {
    const path = join(root, project, 'node_modules', name, 'package.json');
    let version: unknown;
    try {
      version = JSON.parse(readFileSync(path, 'utf8')).version;
    } catch {
      throw new Error(`Cannot verify the installed ${name} version`);
    }
    if (version !== required)
      throw new Error(
        `${name} must use ${required} before accessing the shared state store`,
      );
  }
}

/** Covers app commands and the platform entrypoint they import for state inspection. */
export function assertWorkspaceAlchemyVersion(
  root: string,
  required: string | undefined,
) {
  for (const project of alchemyProjects)
    assertAlchemyVersion(root, required, project);
}

if (import.meta.main)
  assertWorkspaceAlchemyVersion(
    process.cwd(),
    process.env.ALCHEMY_REQUIRED_VERSION,
  );
