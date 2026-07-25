import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createProjectGraphAsync } from 'nx/src/project-graph/project-graph';
import { listWorkspacePackages } from './lib/workspace-packages.ts';

// `workspace:*` and `catalog:` are Bun/pnpm-only protocols. npm doesn't
// rewrite them at pack time when publishing from inside the package dir,
// so consumers outside this monorepo would see literal `workspace:` /
// `catalog:` strings in the published manifest and fail to install. We
// rewrite to concrete versions ourselves, publish, and restore the
// source manifest — keeping `workspace:*`/`catalog:` in the repo as the
// source of truth.

type DepMap = Record<string, string>;
type Manifest = {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: DepMap;
  devDependencies?: DepMap;
  peerDependencies?: DepMap;
  optionalDependencies?: DepMap;
};

// `devDependencies` is included even though installers ignore it: npm ships it
// in the published manifest verbatim, so an unrewritten `catalog:` there is
// still a literal a consumer can read off the registry.
export const PUBLISHED_DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

const PROTOCOL_PREFIXES = ['workspace:', 'catalog:'] as const;

export type SubstitutionContext = {
  catalog: DepMap;
  workspaceVersions: Map<string, string>;
};

export function buildSubstitutionContext(
  cwd: string = process.cwd(),
): SubstitutionContext {
  const rootPkg = JSON.parse(
    readFileSync(join(cwd, 'package.json'), 'utf8'),
  ) as { catalog?: DepMap };
  const catalog: DepMap = rootPkg.catalog ?? {};

  // Private packages are included: a `workspace:` dep can point at one, and it
  // still needs a concrete version written into the published manifest.
  const workspaceVersions = new Map<string, string>(
    listWorkspacePackages(cwd).map((pkg) => [pkg.name, pkg.version]),
  );

  return { catalog, workspaceVersions };
}

export function substituteSpec(
  ctx: SubstitutionContext,
  pkgName: string,
  depName: string,
  spec: string,
): string {
  if (spec.startsWith('workspace:')) {
    const rest = spec.slice('workspace:'.length);
    const resolved = ctx.workspaceVersions.get(depName);
    if (!resolved) {
      throw new Error(
        `${pkgName}: cannot resolve workspace dependency ${depName} (not found in workspaces)`,
      );
    }
    // workspace:* / workspace:^ / workspace:~ → concrete (with the
    // range marker preserved when given). workspace:<range> → <range>.
    if (rest === '' || rest === '*') return resolved;
    if (rest === '^' || rest === '~') return `${rest}${resolved}`;
    return rest;
  }
  if (spec.startsWith('catalog:')) {
    const resolved = ctx.catalog[depName];
    if (!resolved) {
      throw new Error(
        `${pkgName}: dependency ${depName} uses "${spec}" but is not present in root catalog`,
      );
    }
    return resolved;
  }
  return spec;
}

export function substituteDeps(
  ctx: SubstitutionContext,
  pkgName: string,
  deps: DepMap | undefined,
): DepMap | undefined {
  if (!deps) return deps;
  const out: DepMap = {};
  for (const [name, spec] of Object.entries(deps)) {
    out[name] = substituteSpec(ctx, pkgName, name, spec);
  }
  return out;
}

export function substituteManifest(
  ctx: SubstitutionContext,
  manifest: Manifest,
): Manifest {
  const out: Manifest = { ...manifest };
  for (const field of PUBLISHED_DEP_FIELDS) {
    const substituted = substituteDeps(ctx, manifest.name, manifest[field]);
    if (substituted) out[field] = substituted;
  }
  return out;
}

export function assertNoProtocolLiterals(manifest: Manifest): void {
  for (const field of PUBLISHED_DEP_FIELDS) {
    const deps = manifest[field];
    if (!deps) continue;
    for (const [depName, spec] of Object.entries(deps)) {
      if (PROTOCOL_PREFIXES.some((p) => spec.startsWith(p))) {
        throw new Error(
          `${manifest.name}: unresolved protocol "${spec}" in ${field}.${depName} after substitution`,
        );
      }
    }
  }
}

export type PublishOptions = {
  tag: string;
  registry: string;
  dryRun?: boolean;
  verbose?: boolean;
  provenance?: boolean;
  skipPublished?: boolean;
};

export type PublishResult = {
  failures: string[];
  published: string[];
  skipped: string[];
};

// A version already on the registry is immutable, so re-publishing it is a
// hard error rather than a no-op. Treating "already there" as success is what
// makes a re-run after a partial publish able to finish the remaining
// packages instead of dying on the first one that succeeded last time.
function isAlreadyPublished(
  name: string,
  version: string,
  registry: string,
): boolean {
  try {
    execSync(
      `npm view ${name}@${version} version --registry ${registry} --json`,
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return true;
  } catch {
    return false;
  }
}

export async function publishWorkspacePackages(
  options: PublishOptions,
): Promise<PublishResult> {
  const {
    tag,
    registry,
    dryRun = false,
    verbose = false,
    provenance = false,
    skipPublished = false,
  } = options;
  const cwd = process.cwd();

  const ctx = buildSubstitutionContext(cwd);
  const projectGraph = await createProjectGraphAsync();
  const failures: string[] = [];
  const published: string[] = [];
  const skipped: string[] = [];

  for (const node of Object.values(projectGraph.nodes)) {
    const projectRoot = node.data.root;
    const pkgJsonPath = join(cwd, projectRoot, 'package.json');
    let originalContent: string;
    try {
      originalContent = readFileSync(pkgJsonPath, 'utf8');
    } catch {
      continue;
    }
    const pkgJson = JSON.parse(originalContent) as Manifest;
    if (pkgJson.private === true) {
      console.log(`Skipping ${pkgJson.name} (private).`);
      continue;
    }
    if (
      skipPublished &&
      !dryRun &&
      isAlreadyPublished(pkgJson.name, pkgJson.version, registry)
    ) {
      console.log(
        `Skipping ${pkgJson.name}@${pkgJson.version} (already on ${registry}).`,
      );
      skipped.push(pkgJson.name);
      continue;
    }
    const args = ['publish', '--tag', tag, '--registry', registry];
    if (dryRun) args.push('--dry-run');
    if (provenance) args.push('--provenance');
    console.log(
      `\n→ ${pkgJson.name}@${pkgJson.version} → ${registry} [tag=${tag}]${
        provenance ? ' (provenance)' : ''
      }${dryRun ? ' (dry-run)' : ''}`,
    );
    try {
      const transformed = substituteManifest(ctx, pkgJson);
      assertNoProtocolLiterals(transformed);
      writeFileSync(pkgJsonPath, `${JSON.stringify(transformed, null, 2)}\n`);
      execSync(`npm ${args.join(' ')}`, {
        cwd: join(cwd, projectRoot),
        stdio: verbose ? 'inherit' : ['ignore', 'inherit', 'inherit'],
      });
      published.push(pkgJson.name);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith(`${pkgJson.name}: `)) {
        console.error(err.message);
      }
      failures.push(pkgJson.name);
    } finally {
      writeFileSync(pkgJsonPath, originalContent);
    }
  }

  return { failures, published, skipped };
}

// CLI entrypoint. Invoked directly (e.g. by the PR-preview workflow) the
// script versions are bumped beforehand and we only do the publish step
// here. Bun runs this when the file is the entry script.
const isDirectInvocation =
  typeof Bun !== 'undefined' && Bun.main === import.meta.path;

if (isDirectInvocation) {
  const { values } = parseArgs({
    options: {
      tag: { type: 'string' },
      registry: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      provenance: { type: 'boolean', default: false },
      'skip-published': { type: 'boolean', default: false },
    },
  });

  const tag = values.tag;
  if (!tag) {
    console.error('Missing required --tag');
    process.exit(1);
  }

  const registry =
    values.registry ??
    process.env.RELEASE_REGISTRY ??
    'https://registry.npmjs.org';

  const { failures, published, skipped } = await publishWorkspacePackages({
    tag,
    registry,
    dryRun: values['dry-run'],
    verbose: values.verbose,
    provenance: values.provenance,
    skipPublished: values['skip-published'],
  });

  console.log(
    `\nPublished ${published.length}, skipped ${skipped.length}, failed ${failures.length}.`,
  );

  if (failures.length > 0) {
    console.error(`\nPublish failed for: ${failures.join(', ')}`);
    // "A brand-new package cannot publish from CI" is a baffling failure
    // without this: npm refuses to configure a trusted publisher for a package
    // that does not exist yet, so the first version of each has to go out by
    // hand before CI can ever own it.
    console.error(
      'If this was an authentication error, check that every package above has a ' +
        'trusted publisher on npmjs.org pointing at this repository and release.yml. ' +
        'A package that has never been published cannot have one — see the bootstrap ' +
        'procedure in CONTRIBUTING.md.',
    );
    process.exit(1);
  }
}
