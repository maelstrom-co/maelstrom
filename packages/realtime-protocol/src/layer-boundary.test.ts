import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Enforces the package-layering invariant documented in
 * `docs/realtime-voice-architecture.md`: no server-side or worker-side
 * package may depend on a browser-side package, and the contract packages
 * stay dependency-free leaves.
 *
 * This test reads `package.json` manifests directly rather than trusting the
 * doc, because the regression this guards against was a `package.json`
 * dependency edge, not a stale sentence in a doc:
 * `@maelstrom-co/realtime-livekit-server` — a Node-only package that mints
 * LiveKit access tokens and holds `LIVEKIT_API_KEY` — grew a `dependencies`
 * entry on `@maelstrom-co/realtime-livekit`, which declares the browser
 * WebRTC SDK `livekit-client` as a peer dependency. The dependency was added
 * alongside a source import that looked entirely reasonable in review;
 * nothing caught it until a test read the manifest graph.
 */

const repoRoot = resolve(import.meta.dir, '../../..');

type Layer = 'contract' | 'server' | 'worker' | 'browser';

interface WorkspacePackage {
  name: string;
  dir: string;
  pkgJson: {
    private?: boolean;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    exports?: Record<string, unknown>;
  };
}

/** Resolves the root `workspaces` globs (e.g. `"packages/*"`) to directories that contain a `package.json`. Only single-`*`, single-segment globs are supported — that's all this repo's `workspaces` field uses. */
function resolveWorkspaceDirs(globs: readonly string[]): string[] {
  const dirs: string[] = [];
  for (const glob of globs) {
    const segments = glob.split('/');
    let candidates = [repoRoot];
    for (const segment of segments) {
      const next: string[] = [];
      for (const candidate of candidates) {
        if (segment === '*') {
          let entries: string[];
          try {
            entries = readdirSync(candidate, { withFileTypes: true })
              .filter((entry) => entry.isDirectory())
              .map((entry) => entry.name);
          } catch {
            entries = [];
          }
          for (const entry of entries) {
            next.push(join(candidate, entry));
          }
        } else {
          next.push(join(candidate, segment));
        }
      }
      candidates = next;
    }
    dirs.push(...candidates);
  }
  return dirs;
}

function discoverWorkspacePackages(): WorkspacePackage[] {
  const rootPkgJson = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf8'),
  ) as { workspaces?: string[] };
  const workspaceGlobs = rootPkgJson.workspaces ?? [];
  const dirs = resolveWorkspaceDirs(workspaceGlobs);

  const packages: WorkspacePackage[] = [];
  for (const dir of dirs) {
    const pkgJsonPath = join(dir, 'package.json');
    let pkgJson: WorkspacePackage['pkgJson'] & { name?: string };
    try {
      pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    } catch {
      continue;
    }
    // Non-published workspace members (apps, internal tooling) sit outside
    // the layering invariant — it governs the published `@maelstrom-co/*`
    // package graph.
    if (pkgJson.private || !pkgJson.name?.startsWith('@maelstrom-co/')) {
      continue;
    }
    packages.push({ name: pkgJson.name, dir, pkgJson });
  }
  return packages;
}

/**
 * Classifies a package purely from its name, never from a hardcoded list —
 * new packages must fall into a layer automatically:
 *  - contract: the two dependency-free leaves everything else may depend on
 *  - server: names ending in `-server`, plus `@maelstrom-co/engine`
 *  - worker: names ending in `-agent`
 *  - browser: everything else under the `@maelstrom-co` scope
 */
function classify(name: string): Layer {
  if (
    name === '@maelstrom-co/protocol' ||
    name === '@maelstrom-co/realtime-protocol'
  ) {
    return 'contract';
  }
  if (name === '@maelstrom-co/engine' || name.endsWith('-server')) {
    return 'server';
  }
  if (name.endsWith('-agent')) {
    return 'worker';
  }
  return 'browser';
}

function internalDependencyNames(
  pkgJson: WorkspacePackage['pkgJson'],
): string[] {
  const combined = {
    ...(pkgJson.dependencies ?? {}),
    ...(pkgJson.peerDependencies ?? {}),
  };
  return Object.keys(combined).filter((depName) =>
    depName.startsWith('@maelstrom-co/'),
  );
}

const packages = discoverWorkspacePackages();
const packagesByName = new Map(packages.map((pkg) => [pkg.name, pkg]));

const LAYER_BOUNDARY_TEST_PATH =
  'packages/realtime-protocol/src/layer-boundary.test.ts';

function serverOrWorkerDependsOnBrowserMessage(
  pkg: WorkspacePackage,
  layer: Layer,
  depName: string,
): string {
  return `INVARIANT VIOLATED: no server-side or worker-side package may depend on a browser-side package.

  ${pkg.name} (layer: ${layer}) depends on ${depName} (layer: browser).

Server and worker packages run as trusted, Node-only processes — some hold live provider secrets (e.g. @maelstrom-co/realtime-livekit-server holds LIVEKIT_API_KEY). Browser packages exist to ship code into an untrusted browser tab and may legitimately declare browser-only SDKs as (peer) dependencies (e.g. @maelstrom-co/realtime-livekit peer-depends on livekit-client, a browser WebRTC SDK). A server or worker package depending on a browser package drags that browser-only surface — and its transitive dependencies — into a process that should never load it.

This is not hypothetical: @maelstrom-co/realtime-livekit-server (a Node-only package that mints LiveKit access tokens and holds LIVEKIT_API_KEY) once grew a "dependencies" entry on @maelstrom-co/realtime-livekit, which declares the browser WebRTC SDK livekit-client as a peer dependency. It was added alongside a source import that looked entirely reasonable in code review; nothing caught it until this test existed.

Fix: remove the ${depName} dependency from ${pkg.name}'s package.json, or if the two packages need to share logic, move that logic into a contract package (@maelstrom-co/protocol or @maelstrom-co/realtime-protocol) that both layers can already depend on.

See ${LAYER_BOUNDARY_TEST_PATH} for the enforced rule.`;
}

function browserDependsOnServerOrWorkerMessage(
  pkg: WorkspacePackage,
  depName: string,
  depLayer: Layer,
): string {
  return `INVARIANT VIOLATED: no browser-side package may depend on a server-side or worker-side package.

  ${pkg.name} (layer: browser) depends on ${depName} (layer: ${depLayer}).

This is the mirror image of the server-may-not-depend-on-browser rule, and it fails in the more dangerous direction. Server and worker packages are Node-only: they import node: builtins, they pull in Node-only SDKs (livekit-server-sdk, @livekit/agents), and they are the packages that read provider secrets from the environment. A browser package that depends on one puts all of that on the path a consumer's bundler follows from the package root — so the Node-only code is at best shimmed away and at worst shipped to a browser tab, and the secret-reading code sits one careless import away from the client bundle.

Fix: remove the ${depName} dependency from ${pkg.name}'s package.json. A browser package that needs to agree with a minter on a wire shape depends on the contract instead (@maelstrom-co/protocol or @maelstrom-co/realtime-protocol) — that is exactly what the contract layer is for. Credentials cross the boundary at runtime over HTTP, never as a package dependency.

See ${LAYER_BOUNDARY_TEST_PATH} for the enforced rule.`;
}

function contractDependsOnNonContractMessage(
  pkg: WorkspacePackage,
  depName: string,
  depLayer: Layer,
): string {
  return `INVARIANT VIOLATED: no contract package may depend on anything except another contract package.

  ${pkg.name} (layer: contract) depends on ${depName} (layer: ${depLayer}).

Contract packages (@maelstrom-co/protocol, @maelstrom-co/realtime-protocol) are the dependency-free leaves that every browser, server, and worker package in this repo depends on for shared types, zod schemas, and wire contracts. That's only safe because a contract package itself depends on nothing but another contract package. If a contract package pulled in a browser, server, or worker package, every layer that already depends on the contract would transitively gain that dependency too, collapsing the separation the contract exists to preserve.

Fix: remove the ${depName} dependency from ${pkg.name}'s package.json, or move whatever ${pkg.name} needs from ${depName} down into a contract package instead.

See ${LAYER_BOUNDARY_TEST_PATH} for the enforced rule.`;
}

describe('package layering — manifest graph', () => {
  test('discovered at least the known contract, server, worker, and browser packages', () => {
    // Guards the discovery mechanism itself: if the workspace globs ever
    // stopped resolving packages (e.g. a typo'd `workspaces` field), every
    // test below would vacuously pass having checked nothing.
    expect(packages.length).toBeGreaterThanOrEqual(13);
    expect(packagesByName.has('@maelstrom-co/protocol')).toBe(true);
    expect(packagesByName.has('@maelstrom-co/realtime-protocol')).toBe(true);
  });

  for (const pkg of packages) {
    const layer = classify(pkg.name);

    test(`${pkg.name} (${layer}) respects the layering invariant`, () => {
      const violations: string[] = [];

      for (const depName of internalDependencyNames(pkg.pkgJson)) {
        const depPkg = packagesByName.get(depName);
        if (!depPkg) {
          violations.push(
            `${pkg.name} depends on ${depName}, but no non-private workspace package with that name was discovered under the root package.json "workspaces" globs. Fix the dependency name or the workspaces globs.`,
          );
          continue;
        }
        const depLayer = classify(depPkg.name);

        if (
          (layer === 'server' || layer === 'worker') &&
          depLayer === 'browser'
        ) {
          violations.push(
            serverOrWorkerDependsOnBrowserMessage(pkg, layer, depName),
          );
        }

        if (
          layer === 'browser' &&
          (depLayer === 'server' || depLayer === 'worker')
        ) {
          violations.push(
            browserDependsOnServerOrWorkerMessage(pkg, depName, depLayer),
          );
        }

        if (layer === 'contract' && depLayer !== 'contract') {
          violations.push(
            contractDependsOnNonContractMessage(pkg, depName, depLayer),
          );
        }
      }

      if (violations.length > 0) {
        throw new Error(violations.join('\n\n---\n\n'));
      }
    });
  }
});

/**
 * Every module specifier a source file imports, however it imports it:
 * `import x from 'y'`, `export * from 'y'`, bare `import 'y'`, `require('y')`,
 * and dynamic `import('y')`.
 */
const MODULE_SPECIFIER =
  /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"]+)['"]/g;

/**
 * Node builtins under both spellings. The `node:` prefix is the convention
 * here, but `import { readFileSync } from 'fs'` resolves to the same builtin
 * and would slip past a prefix-only check — which is exactly the kind of
 * near-miss this file exists to catch.
 */
const NODE_BUILTINS = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);

function isTestFile(relPathFromSrc: string): boolean {
  return (
    /\.(test|spec)\.tsx?$/.test(relPathFromSrc) ||
    relPathFromSrc.split('/').includes('__tests__')
  );
}

function moduleSpecifiers(source: string): string[] {
  return [...source.matchAll(MODULE_SPECIFIER)].map((match) => match[1] ?? '');
}

/** Resolves a relative import specifier to a source file on disk, undoing the `.js` extension TypeScript's ESM output requires in the import but never on disk. */
function resolveRelativeImport(
  fromFile: string,
  specifier: string,
): string | undefined {
  const base = resolve(dirname(fromFile), specifier);
  const withoutJs = base.replace(/\.jsx?$/, '');
  const candidates = [
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    base,
    join(withoutJs, 'index.ts'),
    join(withoutJs, 'index.tsx'),
  ];
  return candidates.find(
    (candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate),
  );
}

/** Absolute path of the source file behind an `exports` key, read from the `@maelstrom-co/source` condition. */
function entryPointSourceFile(
  pkg: WorkspacePackage,
  key: string,
): string | undefined {
  const value = pkg.pkgJson.exports?.[key];
  const sourceRel =
    typeof value === 'string'
      ? value
      : (value as Record<string, unknown> | undefined)?.[
          '@maelstrom-co/source'
        ];
  return typeof sourceRel === 'string'
    ? resolve(pkg.dir, sourceRel)
    : undefined;
}

/**
 * Walks the module graph from a package's `.` entry point and returns every
 * in-package source file a consumer's bundler would pull in.
 *
 * The reachability walk is the point. Checking only whether a Node-only file
 * *is* a declared entry point answers the wrong question: a file can be the
 * source of `./assets` and still be re-exported from `src/index.ts`, in which
 * case it is both "declared" and reachable from `.` — the membership check
 * passes while the invariant is broken. Only the graph knows.
 */
function filesReachableFromRoot(pkg: WorkspacePackage): Set<string> {
  const rootEntry = entryPointSourceFile(pkg, '.');
  const reachable = new Set<string>();
  if (!rootEntry || !existsSync(rootEntry)) return reachable;

  const queue = [rootEntry];
  reachable.add(rootEntry);
  while (queue.length > 0) {
    const file = queue.pop() as string;
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const target = resolveRelativeImport(file, specifier);
      if (!target || reachable.has(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }
  return reachable;
}

describe('package layering — Node-only code must stay unreachable from "."', () => {
  for (const pkg of packages) {
    if (classify(pkg.name) !== 'browser') continue;

    test(`${pkg.name} (browser) reaches no Node builtin from the "." entry point`, () => {
      const srcDir = join(pkg.dir, 'src');
      const violations: string[] = [];

      for (const file of filesReachableFromRoot(pkg)) {
        const relFromSrc = relative(srcDir, file);
        if (isTestFile(relFromSrc)) continue; // test files never ship in dist and are never reachable from a consumer's import

        let source: string;
        try {
          source = readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        const builtins = moduleSpecifiers(source).filter((specifier) =>
          NODE_BUILTINS.has(specifier),
        );
        if (builtins.length === 0) continue;

        const relFromPkg = relative(pkg.dir, file);
        violations.push(`INVARIANT VIOLATED: within a browser package, no source file reachable from the package root "." may import a Node.js builtin.

  Package: ${pkg.name} (layer: browser)
  File: ${relFromPkg}
  Imports: ${[...new Set(builtins)].sort().join(', ')}

Browser packages ship code that runs in a browser tab; the package root "." import is what a consumer's bundler resolves and ships to that tab. A Node-only builtin (node:fs, node:path, node:crypto, node:child_process, ...) reachable from "." would either crash at runtime in the browser or force every consumer's bundler to shim or exclude it. @maelstrom-co/realtime-vad legitimately ships Node-only tooling of its own — an asset copier for its Silero/ONNX files and a "maelstrom-vad-assets" CLI — but only behind the declared "./assets" entry point and src/bin/, never behind ".".

Reachability is what is checked, not file location: declaring a file as the source of a non-root entry point does not exempt it if src/index.ts also re-exports it, directly or through another module.

Fix: stop re-exporting ${relFromPkg} from the "." entry point (move it behind its own "exports" key or under src/bin/), or remove the Node builtin import if it isn't actually needed there.

See ${LAYER_BOUNDARY_TEST_PATH} for the enforced rule.`);
      }

      if (violations.length > 0) {
        throw new Error(violations.join('\n\n---\n\n'));
      }
    });
  }

  test('the reachability walk actually resolves a known multi-file graph', () => {
    // Guards the walk itself. If resolveRelativeImport() ever stopped
    // resolving `./x.js` to `x.ts`, every test above would pass having
    // inspected one file — the barrel — and nothing else.
    const vad = packagesByName.get('@maelstrom-co/realtime-vad');
    expect(vad).toBeDefined();
    if (!vad) return;

    const reachable = filesReachableFromRoot(vad);
    expect(reachable.size).toBeGreaterThan(1);
    expect(reachable).toContain(resolve(vad.dir, 'src/browser-vad.ts'));
    // The Node-only asset copier is the whole reason this rule exists: it is
    // a declared "./assets" entry point, and it must stay off the "." graph.
    expect(reachable).not.toContain(resolve(vad.dir, 'src/vad-assets.ts'));
  });
});

/**
 * Biome resolves `overrides[].includes` globs relative to the config that
 * *extends* the shared one, not the repo root. Almost every package here
 * carries its own `biome.json` containing `{"extends": "//"}`, so a root-level
 * override targeting `packages/*-server/**` silently matches nothing in
 * exactly the packages it exists to protect. The rule therefore has to be
 * declared in each server/worker package's own config — which is a
 * copy-paste obligation, and copy-paste obligations rot.
 *
 * This block is what stops that rot: it derives the required specifier list
 * from `classify()` and from each browser package's own `exports` map, so
 * adding a browser package, a subpath, or a server/worker package makes the
 * omission a test failure instead of a silently missing lint rule.
 */

/**
 * Every specifier that resolves into a browser package: the bare name plus one
 * per non-root `exports` key.
 *
 * Biome's `noRestrictedImports` matches the specifier string exactly. Listing
 * `@maelstrom-co/realtime-vad` therefore does nothing about
 * `@maelstrom-co/realtime-vad/assets`, which is a real, published subpath —
 * and the Node-only one, so it is the specifier a worker is most likely to
 * reach for. Each subpath needs its own entry.
 */
function browserImportSpecifiers(): string[] {
  const specifiers: string[] = [];
  for (const pkg of packages) {
    if (classify(pkg.name) !== 'browser') continue;
    specifiers.push(pkg.name);
    for (const key of Object.keys(pkg.pkgJson.exports ?? {})) {
      if (key === '.' || key === './package.json') continue;
      specifiers.push(`${pkg.name}${key.slice(1)}`);
    }
  }
  return specifiers.sort();
}

describe('package layering — the Biome backstop must cover every browser package', () => {
  test('the browser specifier list includes published subpaths', () => {
    // Guards the derivation: if the exports walk broke, the list would
    // collapse to bare names and every assertion below would still pass.
    expect(browserImportSpecifiers()).toContain(
      '@maelstrom-co/realtime-vad/assets',
    );
  });

  for (const pkg of packages) {
    const layer = classify(pkg.name);
    if (layer !== 'server' && layer !== 'worker') continue;

    test(`${pkg.name} (${layer}) restricts every browser specifier`, () => {
      const configPath = join(pkg.dir, 'biome.json');
      const relConfigPath = relative(repoRoot, configPath);
      let biomeConfig: {
        linter?: {
          rules?: {
            style?: {
              noRestrictedImports?: {
                options?: { paths?: Record<string, unknown> };
              };
            };
          };
        };
      };
      try {
        biomeConfig = JSON.parse(readFileSync(configPath, 'utf8'));
      } catch {
        throw new Error(`INVARIANT VIOLATED: every server-side and worker-side package must carry its own biome.json declaring the browser-import restrictions.

  Package: ${pkg.name} (layer: ${layer})
  Missing: ${relConfigPath}

Inheriting the root config is not enough, and the failure is silent. Biome resolves an override's "includes" globs relative to the config that extends the shared one, so a root-level override targeting packages/*-server/** does not reach a package that has its own biome.json. Worse, the root globs never matched @maelstrom-co/engine at all — its directory is packages/engine, which is neither *-server nor *-agent — so "it inherits the root rule" is false for engine under every configuration.

Rather than encode which packages the root globs happen to match, this test requires the rule where it is guaranteed to apply: in the package itself.

Fix: create ${relConfigPath} with {"extends": "//"} plus a linter.rules.style.noRestrictedImports block. Copy the shape from packages/realtime-livekit-server/biome.json.

See ${LAYER_BOUNDARY_TEST_PATH} for the enforced rule.`);
      }

      const restricted =
        biomeConfig.linter?.rules?.style?.noRestrictedImports?.options?.paths ??
        {};
      const missing = browserImportSpecifiers().filter(
        (specifier) => !(specifier in restricted),
      );

      if (missing.length > 0) {
        throw new Error(`INVARIANT VIOLATED: a server-side or worker-side package's own biome.json must restrict every specifier that resolves into a browser package.

  Package: ${pkg.name} (layer: ${layer})
  Not restricted: ${missing.join(', ')}

The manifest-graph tests above catch a forbidden *dependency edge*. This lint rule catches the forbidden *import statement* at the line where it is written, which is a far better error location — but only for the specifiers it actually lists. Anything missing from this list is unguarded by lint, and a workspace-hoisted import that never reaches package.json is unguarded by the manifest tests too, so nothing at all would catch it.

Note that Biome matches specifiers exactly. A subpath such as @maelstrom-co/realtime-vad/assets is a separate entry from the bare package name, not a prefix of it.

Because ${pkg.name} has its own biome.json extending the root config, the root-level "overrides" entry does not reach it: Biome interprets override globs relative to the extending config, not the repo root. The rule must be declared here, in this package's own config.

Fix: add the missing entries to ${relConfigPath} under linter.rules.style.noRestrictedImports.options.paths, each with a message pointing at ${LAYER_BOUNDARY_TEST_PATH}. Copy the shape from an existing sibling such as packages/realtime-livekit-server/biome.json.

See ${LAYER_BOUNDARY_TEST_PATH} for the enforced rule.`);
      }
    });
  }
});
