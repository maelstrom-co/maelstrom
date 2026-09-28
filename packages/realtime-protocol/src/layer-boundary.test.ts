import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';

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
    // Apps, infra and internal tooling are composition roots that may wire
    // every layer together, so the invariant governs the library packages
    // under packages/ only. Private libraries there are held to it too: a
    // private server package is still a Node process one dependency edge
    // away from a browser package.
    if (
      relative(repoRoot, dir).split(sep)[0] !== 'packages' ||
      !pkgJson.name?.startsWith('@maelstrom-co/')
    ) {
      continue;
    }
    packages.push({ name: pkgJson.name, dir, pkgJson });
  }
  return packages;
}

/**
 * The packages that ship code to a browser tab. Enumerated rather than
 * inferred, because {@link classify} must fail closed: a name it does not
 * recognize is treated as `server`, the strictest layer.
 *
 * The alternative — defaulting unknown names to `browser` — is unsafe in one
 * direction only, and that direction is the one that matters. A Node-only
 * minter named e.g. `@maelstrom-co/realtime-gemini-mint` matches no `-server`
 * or `-agent` suffix, so it would classify as browser, skip the Biome backstop
 * entirely, and be importable from `@maelstrom-co/react-realtime` with every
 * test green — a credential-reading package one import from the client bundle.
 *
 * Adding a browser package therefore means adding it here. That is a
 * deliberate cost: the omission fails loudly (the new package is held to
 * server rules and has no `biome.json`) instead of silently widening what may
 * reach the browser.
 */
const BROWSER_PACKAGES = new Set([
  '@maelstrom-co/client',
  '@maelstrom-co/react',
  '@maelstrom-co/react-realtime',
  '@maelstrom-co/realtime',
  '@maelstrom-co/realtime-livekit',
  '@maelstrom-co/realtime-openai',
  '@maelstrom-co/realtime-openai-live',
  '@maelstrom-co/realtime-vad',
]);

/**
 * Classifies a package into its layer:
 *  - contract: the two dependency-free leaves everything else may depend on
 *  - server: names ending in `-server`, `@maelstrom-co/engine`, and anything
 *    unrecognized
 *  - worker: names ending in `-agent`
 *  - browser: the explicit {@link BROWSER_PACKAGES} set
 */
function classify(name: string): Layer {
  if (
    name === '@maelstrom-co/protocol' ||
    name === '@maelstrom-co/realtime-protocol' ||
    // Shared client/host wire contracts (heartbeat frames, close-code
    // semantics): a contract leaf so engine hosts import it directly instead
    // of reaching into browser-side @maelstrom-co/client.
    name === '@maelstrom-co/connectors'
  ) {
    return 'contract';
  }
  if (name.endsWith('-agent')) {
    return 'worker';
  }
  if (BROWSER_PACKAGES.has(name)) {
    return 'browser';
  }
  return 'server';
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

  test('discovers private library packages and leaves apps out', () => {
    // A private package under packages/ is a library like any other; only
    // the composition roots outside packages/ sit outside the invariant.
    expect(packagesByName.get('@maelstrom-co/evals')?.pkgJson.private).toBe(
      true,
    );
    expect(packagesByName.has('@maelstrom-co/demo')).toBe(false);
  });

  for (const pkg of packages) {
    const layer = classify(pkg.name);

    test(`${pkg.name} (${layer}) respects the layering invariant`, () => {
      const violations: string[] = [];

      for (const depName of internalDependencyNames(pkg.pkgJson)) {
        const depPkg = packagesByName.get(depName);
        if (!depPkg) {
          violations.push(
            `${pkg.name} depends on ${depName}, but no workspace package with that name was discovered under packages/ through the root package.json "workspaces" globs. Fix the dependency name or the workspaces globs.`,
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

interface WorkspaceImportResolution {
  /** Target identity retained alongside the entry so callers need not infer its package from a source path. */
  package: WorkspacePackage;
  /** Existing TypeScript source selected by the matching `exports` key. */
  entry: string;
}

function rootReachesServerOrWorkerMessage(
  rootPackage: WorkspacePackage,
  rootLayer: Layer,
  targetPackage: WorkspacePackage,
  targetLayer: Layer,
): string {
  return `INVARIANT VIOLATED: no browser-side or contract-side package root may reach a server-side or worker-side package.

  ${rootPackage.name} (root layer: ${rootLayer}) reaches ${targetPackage.name} (layer: ${targetLayer}).

Browser and contract package roots are entry points for code that may ship to an untrusted browser tab. Server and worker packages are trusted, Node-only processes that may import Node-only SDKs or read provider credentials. A root import crossing into those layers puts that trusted code on the browser bundle graph even when the importing package forgot to declare the dependency in its manifest.

Fix: remove the import of ${targetPackage.name} from the source graph rooted at ${rootPackage.name}'s "." export. Shared wire shapes belong in @maelstrom-co/protocol or @maelstrom-co/realtime-protocol; credentials cross the boundary at runtime, never through package imports.

See ${LAYER_BOUNDARY_TEST_PATH} for the enforced rule.`;
}

/**
 * Walks the module graph from a package's `.` entry point and returns every
 * resolvable TypeScript source file a consumer's bundler would pull in across
 * relative imports and allowed workspace-package edges. For a browser or
 * contract root, an edge into a server or worker package throws before the
 * target's export or source path is resolved, so an absent export cannot hide
 * a forbidden package identity. Allowed edges remain traversable when their
 * source entry resolves; an unresolvable allowed edge stays opaque and is skipped.
 *
 * The reachability walk is the point. Checking only whether a Node-only file
 * *is* a declared entry point answers the wrong question: a file can be the
 * source of `./assets` and still be re-exported from `src/index.ts`, in which
 * case it is both "declared" and reachable from `.` — the membership check
 * passes while the invariant is broken. Only the graph knows.
 *
 * `injectedRootSource` replaces only the root file's contents, allowing the
 * regression tests to exercise this exact traversal without writing fixtures.
 */
function filesReachableFromRoot(
  pkg: WorkspacePackage,
  injectedRootSource?: string,
): Set<string> {
  const rootEntry = entryPointSourceFile(pkg, '.');
  const rootLayer = classify(pkg.name);
  // The entry must be TypeScript source under src/. A `.` export that is a
  // plain string, or whose source condition points into dist/, resolves to
  // built output: the walk would then inspect a bundled artifact — where the
  // imports have already been resolved away — and report success without ever
  // reading the package's own source.
  const isSourceEntry =
    rootEntry !== undefined &&
    /\.tsx?$/.test(rootEntry) &&
    !relative(join(pkg.dir, 'src'), rootEntry).startsWith('..');
  if (!isSourceEntry || !existsSync(rootEntry)) {
    // Returning an empty set here would make every assertion built on this
    // walk pass having inspected nothing — the guard would report success on a
    // package it never opened.
    throw new Error(`INVARIANT VIOLATED: every browser-side and contract-side package must resolve a source file for its "." entry point.

  Package: ${pkg.name} (layer: ${classify(pkg.name)})
  Resolved to: ${rootEntry ?? '<no "@maelstrom-co/source" condition on the "." export>'}

The reachability guard below reads the "@maelstrom-co/source" condition so it can walk TypeScript sources without a build step. A package whose "." export omits that condition, nests it inside another condition, or points at a path that does not exist cannot be walked, and a guard that cannot walk a package must fail rather than pass silently.

Fix: give the "." entry in this package's "exports" a top-level "@maelstrom-co/source" key pointing at its TypeScript source, matching the other packages.

See ${LAYER_BOUNDARY_TEST_PATH} for the enforced rule.`);
  }

  const reachable = new Set<string>();
  const queue = [rootEntry];
  reachable.add(rootEntry);
  while (queue.length > 0) {
    const file = queue.pop() as string;
    let source: string;
    try {
      source =
        file === rootEntry && injectedRootSource !== undefined
          ? injectedRootSource
          : readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const specifier of moduleSpecifiers(source)) {
      // Workspace-internal specifiers are followed across the package
      // boundary. Stopping at the package edge would let a browser package
      // re-export a sibling's Node-only subpath — `export * from
      // '@maelstrom-co/realtime-vad/assets'` — and satisfy every guard: the
      // manifest test sees an allowed browser→browser edge, and this walk
      // never opens the file that imports `node:fs`.
      let target: string | undefined;
      if (specifier.startsWith('.')) {
        target = resolveRelativeImport(file, specifier);
      } else if (specifier.startsWith('@maelstrom-co/')) {
        const targetPackage = workspacePackageForSpecifier(specifier);
        if (targetPackage) {
          const targetLayer = classify(targetPackage.name);
          if (
            (rootLayer === 'browser' || rootLayer === 'contract') &&
            (targetLayer === 'server' || targetLayer === 'worker')
          ) {
            throw new Error(
              rootReachesServerOrWorkerMessage(
                pkg,
                rootLayer,
                targetPackage,
                targetLayer,
              ),
            );
          }
          target = resolveWorkspaceImportEntry(targetPackage, specifier);
        }
      }
      if (!target || reachable.has(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }
  return reachable;
}

/** Returns package identity from a root or subpath specifier before export lookup; unknown workspace package names return `undefined`. */
function workspacePackageForSpecifier(
  specifier: string,
): WorkspacePackage | undefined {
  const segments = specifier.split('/');
  return packagesByName.get(`${segments[0]}/${segments[1]}`);
}

/** Resolves an already identified, policy-allowed package's requested export to an existing source file; missing exports and source files return `undefined`. */
function resolveWorkspaceImportEntry(
  target: WorkspacePackage,
  specifier: string,
): string | undefined {
  const segments = specifier.split('/');
  const key = segments.length > 2 ? `./${segments.slice(2).join('/')}` : '.';
  const entry = entryPointSourceFile(target, key);
  return entry && existsSync(entry) ? entry : undefined;
}

/**
 * Resolves `@maelstrom-co/foo` or `@maelstrom-co/foo/bar` to the workspace
 * package and source file behind its matching `exports` key.
 * Unknown packages, missing export keys, and missing source files remain
 * unresolved so external or unavailable specifiers stay opaque. This
 * convenience composition is not suitable for custody enforcement by itself:
 * it cannot distinguish an unknown package from a known package whose entry is
 * unresolvable. The graph walk therefore performs package lookup and layer
 * enforcement before attempting entry resolution.
 */
function resolveWorkspaceImport(
  specifier: string,
): WorkspaceImportResolution | undefined {
  const target = workspacePackageForSpecifier(specifier);
  if (!target) return undefined;
  const entry = resolveWorkspaceImportEntry(target, specifier);
  return entry ? { package: target, entry } : undefined;
}

describe('package layering — Node-only code must stay unreachable from "."', () => {
  const forbiddenRootEdges = [
    {
      origin: '@maelstrom-co/realtime-openai',
      destination: '@maelstrom-co/realtime-openai-server',
    },
    {
      origin: '@maelstrom-co/realtime-openai',
      destination: '@maelstrom-co/realtime-livekit-agent',
    },
    {
      origin: '@maelstrom-co/realtime-protocol',
      destination: '@maelstrom-co/realtime-openai-server',
    },
    {
      origin: '@maelstrom-co/realtime-protocol',
      destination: '@maelstrom-co/realtime-livekit-agent',
    },
  ] as const;

  for (const { origin, destination } of forbiddenRootEdges) {
    test(`${origin} root rejects reachability into ${destination}`, () => {
      const originPackage = packagesByName.get(origin);
      expect(originPackage).toBeDefined();
      if (!originPackage) return;

      const originLayer = classify(origin);
      const destinationLayer = classify(destination);
      expect(() =>
        filesReachableFromRoot(
          originPackage,
          `export * from '${destination}';`,
        ),
      ).toThrow(
        `INVARIANT VIOLATED: no browser-side or contract-side package root may reach a server-side or worker-side package.\n\n  ${origin} (root layer: ${originLayer}) reaches ${destination} (layer: ${destinationLayer}).`,
      );
    });
  }

  const unresolvableForbiddenRootEdges = [
    {
      origin: '@maelstrom-co/realtime-openai',
      destination: '@maelstrom-co/realtime-openai-server',
      specifier: '@maelstrom-co/realtime-openai-server/not-exported',
    },
    {
      origin: '@maelstrom-co/realtime-protocol',
      destination: '@maelstrom-co/realtime-livekit-agent',
      specifier: '@maelstrom-co/realtime-livekit-agent/not-exported',
    },
  ] as const;

  for (const {
    origin,
    destination,
    specifier,
  } of unresolvableForbiddenRootEdges) {
    test(`${origin} root rejects ${specifier} before resolving its entry`, () => {
      const originPackage = packagesByName.get(origin);
      expect(originPackage).toBeDefined();
      if (!originPackage) return;

      const originLayer = classify(origin);
      const destinationLayer = classify(destination);
      expect(() =>
        filesReachableFromRoot(originPackage, `export * from '${specifier}';`),
      ).toThrow(
        `INVARIANT VIOLATED: no browser-side or contract-side package root may reach a server-side or worker-side package.\n\n  ${origin} (root layer: ${originLayer}) reaches ${destination} (layer: ${destinationLayer}).`,
      );
    });
  }

  test('workspace imports retain package metadata for declared subpaths', () => {
    const resolved = resolveWorkspaceImport(
      '@maelstrom-co/realtime-protocol/openai',
    );
    expect(resolved?.package.name).toBe('@maelstrom-co/realtime-protocol');
    expect(resolved?.entry).toBe(
      resolve(
        packagesByName.get('@maelstrom-co/realtime-protocol')?.dir ?? '',
        'src/openai.ts',
      ),
    );
  });

  for (const pkg of packages) {
    const layer = classify(pkg.name);
    // Contract packages are checked alongside browser ones because they are
    // `export *`-ed straight out of browser barrels — `@maelstrom-co/realtime-openai`
    // re-exports `@maelstrom-co/realtime-protocol/openai`, and the LiveKit
    // adapter does the same — so they sit on the very `.` graph this block
    // polices. They are browser-safe by construction today; asserting it pins
    // the property.
    if (layer !== 'browser' && layer !== 'contract') continue;

    test(`${pkg.name} (${layer}) reaches no Node builtin from the "." entry point`, () => {
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

  test('the livekit-wire subpath pulls in nothing at all', () => {
    // The worker imports this subpath to read four topic strings. Its sibling
    // `/livekit` aggregates LiveKitTokenGrantSchema, which imports zod, so
    // pointing the worker there would load a schema runtime at boot for
    // constants that cost nothing. Splitting the subpath is only worth
    // anything while it stays import-free.
    const protocolPkg = packagesByName.get('@maelstrom-co/realtime-protocol');
    expect(protocolPkg).toBeDefined();
    if (!protocolPkg) return;

    const entry = entryPointSourceFile(protocolPkg, './livekit-wire');
    expect(entry).toBeDefined();
    if (!entry) return;

    const seen = new Set<string>();
    const queue = [entry];
    const external: string[] = [];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const specifier of moduleSpecifiers(readFileSync(file, 'utf8'))) {
        if (!specifier.startsWith('.')) {
          external.push(
            `${relative(protocolPkg.dir, file)} imports ${specifier}`,
          );
          continue;
        }
        const target = resolveRelativeImport(file, specifier);
        if (target) queue.push(target);
      }
    }

    expect(external).toEqual([]);
  });

  test('an unrecognized package name classifies as server, not browser', () => {
    // The direction of this default is the whole point. A future Node-only
    // minter matching no known suffix must land in the strictest layer, where
    // the Biome backstop applies to it, rather than being waved through as a
    // browser package that anything may import.
    expect(classify('@maelstrom-co/realtime-gemini-mint')).toBe('server');
    expect(classify('@maelstrom-co/something-nobody-listed')).toBe('server');
    // And the known browser packages must still classify as browser, or the
    // assertion above would hold vacuously with every package called server.
    expect(classify('@maelstrom-co/realtime-livekit')).toBe('browser');
    expect(classify('@maelstrom-co/react')).toBe('browser');
  });

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
                level?: string;
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

      const rule = biomeConfig.linter?.rules?.style?.noRestrictedImports;

      // A listed path enforces nothing if the rule itself is switched off.
      // Silencing a false positive with `"level": "off"` while leaving `paths`
      // intact is the realistic way this decays, and it would otherwise keep
      // every assertion below green.
      if (rule?.level !== undefined && rule.level !== 'error') {
        throw new Error(`INVARIANT VIOLATED: a server-side or worker-side package must keep noRestrictedImports at "error".

  Package: ${pkg.name} (layer: ${layer})
  Config: ${relConfigPath}
  Level: "${rule.level}"

The paths list below is only as strong as the rule carrying it. Setting the level to "off" or "warn" leaves the restrictions in place as documentation while "nx run-many -t check" stops reporting them, so this package could import a browser package with no signal at all. The Biome plugin runs with --error-on-warnings, so "warn" is no safer than "off" in CI, but it is quieter locally.

Fix: set "level": "error" in ${relConfigPath}, or omit the key to inherit the shared config's level. If a specific import is a genuine false positive, exempt that import with a "// biome-ignore" comment stating the invariant rather than disabling the rule for the whole package.

See ${LAYER_BOUNDARY_TEST_PATH} for the enforced rule.`);
      }

      const restricted = rule?.options?.paths ?? {};
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
