import { describe, expect, test } from 'bun:test';
import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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

/** Matches `import ... from 'node:x'`, `require('node:x')`, and dynamic `import('node:x')` — the ways a source file can reach a Node.js builtin. */
const NODE_BUILTIN_IMPORT =
  /(?:from\s+|require\(\s*|import\(\s*)['"]node:[^'"]+['"]/;

function isTestFile(relPathFromSrc: string): boolean {
  return (
    /\.(test|spec)\.tsx?$/.test(relPathFromSrc) ||
    relPathFromSrc.split('/').includes('__tests__')
  );
}

function walkTsFiles(dir: string): string[] {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/** Absolute paths of the source files behind every non-root `exports` entry point (i.e. every key except `.` and `./package.json`), read from the `@maelstrom-co/source` condition. */
function declaredEntryPointSourceFiles(pkg: WorkspacePackage): Set<string> {
  const files = new Set<string>();
  const exportsMap = pkg.pkgJson.exports ?? {};
  for (const [key, value] of Object.entries(exportsMap)) {
    if (key === '.' || key === './package.json') continue;
    const sourceRel =
      typeof value === 'string'
        ? value
        : (value as Record<string, unknown> | undefined)?.[
            '@maelstrom-co/source'
          ];
    if (typeof sourceRel === 'string') {
      files.add(resolve(pkg.dir, sourceRel));
    }
  }
  return files;
}

describe('package layering — Node-only code must stay behind a declared entry point', () => {
  for (const pkg of packages) {
    if (classify(pkg.name) !== 'browser') continue;

    test(`${pkg.name} (browser) keeps node: imports out of the "." entry point`, () => {
      const srcDir = join(pkg.dir, 'src');
      const entryPointFiles = declaredEntryPointSourceFiles(pkg);
      const violations: string[] = [];

      for (const file of walkTsFiles(srcDir)) {
        const relFromSrc = relative(srcDir, file);
        if (isTestFile(relFromSrc)) continue; // test files never ship in dist and are never reachable from a consumer's import

        const source = readFileSync(file, 'utf8');
        if (!NODE_BUILTIN_IMPORT.test(source)) continue;

        const isUnderBin = relFromSrc.split('/')[0] === 'bin';
        const isDeclaredEntryPoint = entryPointFiles.has(resolve(file));
        if (isUnderBin || isDeclaredEntryPoint) continue;

        const relFromPkg = relative(pkg.dir, file);
        violations.push(`INVARIANT VIOLATED: within a browser package, a source file that imports a Node.js builtin must live under src/bin/ or be the source of a declared non-root entry point in that package's package.json "exports" map — never reachable from the package root ".".

  Package: ${pkg.name} (layer: browser)
  File: ${relFromPkg}

Browser packages ship code that runs in a browser tab; the package root "." import is what a consumer's bundler resolves and ships to that tab. A Node-only builtin (node:fs, node:path, node:crypto, node:child_process, ...) reachable from "." would either crash at runtime in the browser or force every consumer's bundler to shim or exclude it. @maelstrom-co/realtime-vad legitimately ships Node-only tooling of its own — an asset copier for its Silero/ONNX files and a "maelstrom-vad-assets" CLI — but only behind the declared "./assets" entry point and src/bin/, never behind ".".

Fix: move ${relFromPkg} under src/bin/, declare a new non-root entry point for it in ${pkg.name}'s package.json "exports" map, or remove the node: import if it isn't actually needed there.

See ${LAYER_BOUNDARY_TEST_PATH} for the enforced rule.`);
      }

      if (violations.length > 0) {
        throw new Error(violations.join('\n\n---\n\n'));
      }
    });
  }
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
 * This block is what stops that rot: it derives the browser package list from
 * `classify()`, so adding a browser package or a server/worker package makes
 * the omission a test failure instead of a silently missing lint rule.
 */
function browserPackageNames(): string[] {
  return packages
    .map((pkg) => pkg.name)
    .filter((name) => classify(name) === 'browser')
    .sort();
}

describe('package layering — the Biome backstop must cover every browser package', () => {
  for (const pkg of packages) {
    const layer = classify(pkg.name);
    if (layer !== 'server' && layer !== 'worker') continue;

    test(`${pkg.name} (${layer}) restricts imports of every browser package`, () => {
      let biomeConfig: {
        linter?: {
          rules?: {
            style?: {
              noRestrictedImports?: { options?: { paths?: Record<string, unknown> } };
            };
          };
        };
      };
      try {
        biomeConfig = JSON.parse(
          readFileSync(join(pkg.dir, 'biome.json'), 'utf8'),
        );
      } catch {
        // No own config means the package inherits the root one, where the
        // override glob does apply. Nothing to assert.
        return;
      }

      const restricted =
        biomeConfig.linter?.rules?.style?.noRestrictedImports?.options?.paths ??
        {};
      const missing = browserPackageNames().filter(
        (name) => !(name in restricted),
      );

      if (missing.length > 0) {
        throw new Error(`INVARIANT VIOLATED: a server-side or worker-side package's own biome.json must restrict imports of every browser package.

  Package: ${pkg.name} (layer: ${layer})
  Not restricted: ${missing.join(', ')}

The manifest-graph tests above catch a forbidden *dependency edge*. This lint rule catches the forbidden *import statement* at the line where it is written, which is a far better error location — but only for the browser packages it actually lists. A browser package missing from this list is unguarded by lint.

Because ${pkg.name} has its own biome.json extending the root config, the root-level "overrides" entry does not reach it: Biome interprets override globs relative to the extending config, not the repo root. The rule must be declared here, in this package's own config.

Fix: add the missing entries to ${relative(repoRoot, join(pkg.dir, 'biome.json'))} under linter.rules.style.noRestrictedImports.options.paths, each with a message pointing at ${LAYER_BOUNDARY_TEST_PATH}. Copy the shape from an existing sibling such as packages/realtime-livekit-server/biome.json.

See ${LAYER_BOUNDARY_TEST_PATH} for the enforced rule.`);
      }
    });
  }
});
