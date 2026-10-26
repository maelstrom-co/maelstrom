import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  PACKED_MANIFEST_FILENAME,
  PACKED_PACKAGE_NAMES,
  validatePackedManifest,
} from './lib/packed-manifest.ts';
import {
  assertBoundedClientValidation,
  assertBoundedSdkValidation,
  assertBundledValidationSources,
  type BoundedSdkSchema,
  type SdkVesselManagerConstructor,
} from './lib/sdk-validation.ts';

const { values } = parseArgs({
  options: {
    entry: { type: 'string' },
    'client-entry': { type: 'string' },
    'tarballs-dir': { type: 'string' },
  },
});
if (values['tarballs-dir'] && (values.entry || values['client-entry']))
  throw new Error('Choose packed artifacts or explicit entrypoints');
const roots = new Map(
  PACKED_PACKAGE_NAMES.map((name) => [
    name as string,
    resolve('packages', name.split('/')[1]),
  ]),
);
const rootFor = (name: string): string => {
  const root = roots.get(name);
  if (!root) throw new Error(`SDK source root is missing: ${name}`);
  return root;
};
let scratch: string | undefined;
try {
  if (values['tarballs-dir']) {
    const directory = resolve(values['tarballs-dir']);
    const version = JSON.parse(
      readFileSync('packages/protocol/package.json', 'utf8'),
    ).version;
    const manifest: unknown = JSON.parse(
      readFileSync(join(directory, PACKED_MANIFEST_FILENAME), 'utf8'),
    );
    const packages = validatePackedManifest(manifest, version, directory);
    const temporaryRoot = resolve('tmp');
    mkdirSync(temporaryRoot, { recursive: true });
    scratch = mkdtempSync(join(temporaryRoot, 'sdk-validation-'));
    for (const [index, pkg] of packages.entries()) {
      const output = join(scratch, String(index));
      mkdirSync(output);
      execFileSync('tar', ['-xf', pkg.tarballPath, '-C', output], {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      const packageRoot = join(output, 'package');
      const frozenDependencies = join(rootFor(pkg.name), 'node_modules');
      if (existsSync(frozenDependencies))
        symlinkSync(
          frozenDependencies,
          join(packageRoot, 'node_modules'),
          'dir',
        );
      roots.set(pkg.name, packageRoot);
    }
  }
  for (const [name, root] of roots) {
    const paths = [
      ...new Bun.Glob('**/*.js').scanSync({
        cwd: join(root, 'dist'),
        absolute: true,
      }),
    ];
    if (paths.length === 0)
      throw new Error(`${name}: SDK runtime files are missing`);
    assertBundledValidationSources(
      paths.map((path) => readFileSync(path, 'utf8')),
      name,
    );
  }
  const load = (entry: string): Record<string, unknown> => {
    const module: unknown = createRequire(import.meta.url)(entry);
    if (module === null || typeof module !== 'object')
      throw new Error('SDK module is invalid');
    return module as Record<string, unknown>;
  };
  const protocol = load(
    resolve(
      values.entry ?? join(rootFor('@maelstrom-co/protocol'), 'dist/index.js'),
    ),
  );
  const schema = protocol.SessionIdSchema;
  if (
    schema === null ||
    typeof schema !== 'object' ||
    !('transform' in schema) ||
    typeof schema.transform !== 'function'
  )
    throw new Error('SDK identifier schema is invalid');
  assertBoundedSdkValidation(schema as BoundedSdkSchema);
  const client = load(
    resolve(
      values['client-entry'] ??
        join(rootFor('@maelstrom-co/client'), 'dist/index.js'),
    ),
  );
  if (typeof client.VesselManager !== 'function')
    throw new Error('Client vessel registry is missing');
  assertBoundedClientValidation(
    client.VesselManager as SdkVesselManagerConstructor,
  );
  console.log(`SDK validation checks passed across ${roots.size} packages.`);
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
