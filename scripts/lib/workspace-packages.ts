import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type WorkspacePackage = {
  name: string;
  version: string;
  isPrivate: boolean;
  dir: string;
  manifestPath: string;
};

// Walks the root `workspaces` globs rather than hardcoding `packages/*`, so a
// publishable package added anywhere the workspace already covers is picked up
// by every release check instead of being silently skipped by one of them.
// Deliberately does not boot the Nx project graph: the release steps that use
// this run before and after the build, where paying for a graph is wasteful.
export function listWorkspacePackages(
  cwd: string = process.cwd(),
): WorkspacePackage[] {
  const rootPkg = JSON.parse(
    readFileSync(join(cwd, 'package.json'), 'utf8'),
  ) as { workspaces?: string[] };

  const found: WorkspacePackage[] = [];
  for (const glob of rootPkg.workspaces ?? []) {
    // Only "<dir>/*" entries are understood. Skipping a fancier glob silently
    // would make a publishable package invisible to the release checks that
    // are supposed to guard it, so say so loudly instead.
    const match = /^(.+)\/\*$/.exec(glob);
    if (!match) {
      console.warn(
        `::warning::Workspace glob "${glob}" is not of the form "<dir>/*" and was not scanned for packages.`,
      );
      continue;
    }
    const parent = join(cwd, match[1]);
    let entries: string[] = [];
    try {
      entries = readdirSync(parent);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const dir = join(parent, entry);
      const manifestPath = join(dir, 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          name?: string;
          version?: string;
          private?: boolean;
        };
        if (!pkg.name || !pkg.version) continue;
        found.push({
          name: pkg.name,
          version: pkg.version,
          isPrivate: pkg.private === true,
          dir,
          manifestPath,
        });
      } catch {
        // Not every directory under a workspace glob is a package.
      }
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export function listPublishablePackages(
  cwd: string = process.cwd(),
): WorkspacePackage[] {
  return listWorkspacePackages(cwd).filter((pkg) => !pkg.isPrivate);
}
