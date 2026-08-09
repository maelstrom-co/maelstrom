import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createProjectGraphAsync } from 'nx/src/project-graph/project-graph';
import {
  PACKED_MANIFEST_FILENAME,
  type PackedPackage,
} from './lib/packed-manifest.ts';
import {
  authenticationFailureHint,
  isAlreadyPublished,
  resolveRegistry,
} from './lib/registry.ts';
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
  /**
   * Pack tarballs into this directory instead of publishing. Used by the
   * release workflow's prepare job, which builds without an npm identity and
   * hands the artifacts to a publish job that has one.
   */
  packTo?: string;
};

export type PublishResult = {
  failures: string[];
  /**
   * Packages whose npm invocation succeeded. Under `dryRun` nothing was
   * uploaded, so read this together with `dryRun` rather than as a record of
   * what is on the registry.
   */
  succeeded: string[];
  skipped: string[];
  dryRun: boolean;
  /** Tarballs written under `packTo`; empty unless packing. */
  packed: PackedPackage[];
};

// `npm pack --json` prints an array of pack reports; the filename is the only
// reliable way to know what landed, since npm — not us — decides how a scoped
// name and version become a tarball name.
function packTarball(
  packageDir: string,
  destination: string,
  verbose: boolean,
): string {
  const stdout = execFileSync(
    'npm',
    ['pack', '--pack-destination', destination, '--json'],
    { cwd: packageDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const reports = JSON.parse(stdout) as Array<{ filename?: string }>;
  const filename = reports[0]?.filename;
  if (!filename) {
    throw new Error(`npm pack reported no tarball for ${packageDir}`);
  }
  if (verbose) console.log(`  packed ${filename}`);
  return filename;
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
    packTo,
  } = options;
  const cwd = process.cwd();
  const packDestination = packTo ? resolve(cwd, packTo) : undefined;
  if (packDestination) mkdirSync(packDestination, { recursive: true });

  const ctx = buildSubstitutionContext(cwd);
  const projectGraph = await createProjectGraphAsync();
  const failures: string[] = [];
  const succeeded: string[] = [];
  const skipped: string[] = [];
  const packed: PackedPackage[] = [];

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
    // Packing answers a different question than publishing, so the
    // already-published probe is the publish job's business, not this one's.
    if (skipPublished && !dryRun && !packDestination) {
      let already: boolean;
      try {
        already = isAlreadyPublished(pkgJson.name, pkgJson.version, registry);
      } catch (err) {
        // An indeterminate check is this package's failure, not the run's:
        // the rest can still go out, and the summary reports the whole
        // picture instead of stopping at the first unreachable lookup.
        console.error(err instanceof Error ? err.message : String(err));
        failures.push(pkgJson.name);
        continue;
      }
      if (already) {
        console.log(
          `Skipping ${pkgJson.name}@${pkgJson.version} (already on ${registry}).`,
        );
        skipped.push(pkgJson.name);
        continue;
      }
    }
    const args = ['publish', '--tag', tag, '--registry', registry];
    if (dryRun) args.push('--dry-run');
    if (provenance) args.push('--provenance');
    console.log(
      packDestination
        ? `\n→ packing ${pkgJson.name}@${pkgJson.version}`
        : `\n→ ${pkgJson.name}@${pkgJson.version} → ${registry} [tag=${tag}]${
            provenance ? ' (provenance)' : ''
          }${dryRun ? ' (dry-run)' : ''}`,
    );
    try {
      const transformed = substituteManifest(ctx, pkgJson);
      assertNoProtocolLiterals(transformed);
      writeFileSync(pkgJsonPath, `${JSON.stringify(transformed, null, 2)}\n`);
      if (packDestination) {
        packed.push({
          name: pkgJson.name,
          version: pkgJson.version,
          tarball: packTarball(
            join(cwd, projectRoot),
            packDestination,
            verbose,
          ),
        });
      } else {
        // No shell: `tag` comes from a git tag name, and a shell string here
        // was a confirmed injection into a job that can publish to npm.
        execFileSync('npm', args, {
          cwd: join(cwd, projectRoot),
          stdio: verbose ? 'inherit' : ['ignore', 'inherit', 'inherit'],
        });
      }
      succeeded.push(pkgJson.name);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith(`${pkgJson.name}: `)) {
        console.error(err.message);
      }
      failures.push(pkgJson.name);
    } finally {
      writeFileSync(pkgJsonPath, originalContent);
    }
  }

  if (packDestination) {
    writeFileSync(
      join(packDestination, PACKED_MANIFEST_FILENAME),
      `${JSON.stringify(packed, null, 2)}\n`,
    );
  }

  return { failures, succeeded, skipped, dryRun, packed };
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
      'pack-to': { type: 'string' },
    },
  });

  const packTo = values['pack-to'];
  // Packing never reaches a registry, so a tag would only be decoration —
  // the publish job applies the dist-tag when it uploads the tarball.
  const tag = values.tag ?? (packTo ? 'pack' : undefined);
  if (!tag) {
    console.error('Missing required --tag');
    process.exit(1);
  }

  const registry = resolveRegistry(values.registry);

  const { failures, succeeded, skipped, dryRun } =
    await publishWorkspacePackages({
      tag,
      registry,
      dryRun: values['dry-run'],
      verbose: values.verbose,
      provenance: values.provenance,
      skipPublished: values['skip-published'],
      packTo,
    });

  // A dry run uploads nothing. Reporting "Published 10" for one invites
  // exactly the misreading that makes a rehearsal feel like a release.
  const verb = packTo ? 'Packed' : dryRun ? 'Would publish' : 'Published';
  console.log(
    `\n${verb} ${succeeded.length}, skipped ${skipped.length}, failed ${failures.length}.`,
  );

  if (failures.length > 0) {
    console.error(
      `\n${packTo ? 'Pack' : 'Publish'} failed for: ${failures.join(', ')}`,
    );
    if (!packTo) {
      console.error(authenticationFailureHint(registry));
    }
    process.exit(1);
  }
}
