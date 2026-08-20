import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import ts from 'typescript';

export interface Finding {
  path: string;
  line: number;
  rule: string;
  text: string;
}

export interface AuditError {
  path: string;
  rule: string;
  message: string;
  target?: string;
}

export interface AuditReport {
  errors: AuditError[];
  findings: Finding[];
  scanned: string[];
}

export interface PackageAuditInput {
  name: string;
  tarball: string;
}

interface PublicPackage {
  directory: string;
  manifest: PackageManifest;
}

interface PackageManifest {
  name: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  publishConfig?: { access?: string };
}

interface ForbiddenRule {
  name: string;
  pattern: RegExp;
}

export const FORBIDDEN_RULES: readonly ForbiddenRule[] = [
  { name: 'numeric-ticket-id', pattern: /\bMAE-\d+\b/ },
  { name: 'roadmap-marker', pattern: /\b(?:TODO(?:\([^)]*\))?|FIXME|HACK)\b/i },
  {
    name: 'company-internal-reference',
    pattern:
      /\b(?:company-internal|internal (?:issue|ticket|tracker|documentation|docs))\b/i,
  },
  {
    name: 'implementation-history',
    pattern:
      /\b(?:implemented for|fix [A-Z]\b|previously fixed|historical fix)\b/i,
  },
  { name: 'grep-instruction', pattern: /\bgrep\s+[`'"]/i },
  {
    name: 'internal-only-explanation',
    pattern:
      /\b(?:internal-only|not part of (?:the )?public API|not public because|only exported through (?:the )?barrel)\b/i,
  },
];

const declarationPattern = /\.d\.(?:ts|mts|cts)$/;
const invalidDependencyProtocol =
  /^(?:catalog:|workspace:|link:|file:|portal:|patch:)/;
const consumerDependencyFields = ['dependencies', 'peerDependencies'] as const;

function sorted<T>(values: T[], key: (value: T) => string): T[] {
  return values.sort((left, right) =>
    key(left).localeCompare(key(right), 'en'),
  );
}

function scanContents(
  entries: Array<{ path: string; contents: string }>,
): AuditReport {
  const findings: Finding[] = [];
  for (const entry of sorted(entries, ({ path }) => path)) {
    for (const [index, text] of entry.contents.split(/\r?\n/).entries()) {
      for (const rule of FORBIDDEN_RULES) {
        if (rule.pattern.test(text)) {
          findings.push({
            path: entry.path,
            line: index + 1,
            rule: rule.name,
            text: text.trim(),
          });
        }
      }
    }
  }
  return {
    errors: [],
    findings: sorted(
      findings,
      (finding) =>
        `${finding.path}\0${finding.line.toString().padStart(8, '0')}\0${finding.rule}`,
    ),
    scanned: entries.map(({ path }) => path).sort(),
  };
}

export async function auditArtifactFiles(
  paths: string[],
): Promise<AuditReport> {
  if (paths.length === 0) {
    return {
      errors: [
        {
          path: '.',
          rule: 'empty-artifact-input',
          message: 'No artifact files were provided.',
        },
      ],
      findings: [],
      scanned: [],
    };
  }
  const entries: Array<{ path: string; contents: string }> = [];
  const errors: AuditError[] = [];
  for (const path of [...paths].sort()) {
    try {
      entries.push({ path, contents: await readFile(path, 'utf8') });
    } catch {
      errors.push({
        path,
        rule: 'missing-artifact',
        message: 'Artifact does not exist or cannot be read.',
      });
    }
  }
  return { ...scanContents(entries), errors };
}

function run(
  command: string[],
  cwd?: string,
  env?: Record<string, string>,
): { exitCode: number; stderr: string; stdout: string } {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, ...env },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

function tarMembers(tarball: string): string[] {
  const result = run(['tar', '-tzf', tarball]);
  if (result.exitCode !== 0) {
    throw new Error(`Cannot list ${tarball}: ${result.stderr.trim()}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((member) => member.replace(/^\.\//, ''))
    .sort();
}

function readTarMember(tarball: string, member: string): string {
  const result = run(['tar', '-xOzf', tarball, member]);
  if (result.exitCode !== 0) {
    throw new Error(
      `Cannot read ${member} from ${tarball}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

function collectExportTargets(
  exportsValue: unknown,
): Array<{ condition: string; target: string }> {
  const targets: Array<{ condition: string; target: string }> = [];
  const visit = (value: unknown, condition: string): void => {
    if (typeof value === 'string') {
      targets.push({ condition, target: value });
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, condition);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === '@maelstrom-co/source') continue;
      visit(child, key.startsWith('.') ? condition : key);
    }
  };
  visit(exportsValue, 'default');
  return sorted(targets, ({ condition, target }) => `${target}\0${condition}`);
}

function isRelativeExportTarget(target: string): boolean {
  return target.startsWith('./');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates an optional manifest dependency field and returns a string-only
 * copy. Missing fields remain absent; malformed containers or values throw with
 * the precise manifest path.
 */
function validateStringMap(
  manifest: Record<string, unknown>,
  field: 'dependencies' | 'peerDependencies',
): Record<string, string> | undefined {
  const value = manifest[field];
  if (value === undefined) return undefined;
  if (!isPlainRecord(value))
    throw new Error(
      `Invalid package/package.json: ${field} must be an object with string values.`,
    );
  const validated: Record<string, string> = {};
  for (const [name, specifier] of Object.entries(value)) {
    if (typeof specifier !== 'string')
      throw new Error(
        `Invalid package/package.json: ${field}.${name} must be a string.`,
      );
    validated[name] = specifier;
  }
  return validated;
}

function validateExportValue(value: unknown, path = 'exports'): void {
  if (value === null || typeof value === 'string') return;
  if (Array.isArray(value)) {
    for (const [index, fallback] of value.entries()) {
      validateExportValue(fallback, `${path}[${index}]`);
    }
    return;
  }
  if (isPlainRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      validateExportValue(child, `${path}.${key}`);
    }
    return;
  }
  throw new Error(
    `Invalid package/package.json: ${path} must be a string, null, array, or object.`,
  );
}

function parsePackedManifest(
  tarball: string,
  members: string[],
): PackageManifest {
  const manifestMember = members.find(
    (member) => member === 'package/package.json',
  );
  if (!manifestMember)
    throw new Error(`${tarball} does not contain package/package.json.`);
  const manifest: unknown = JSON.parse(readTarMember(tarball, manifestMember));
  if (!isPlainRecord(manifest))
    throw new Error(
      'Invalid package/package.json: expected a top-level object.',
    );
  if (typeof manifest.name !== 'string')
    throw new Error('Invalid package/package.json: name must be a string.');
  if (manifest.exports !== undefined) validateExportValue(manifest.exports);
  return {
    name: manifest.name,
    exports: manifest.exports,
    dependencies: validateStringMap(manifest, 'dependencies'),
    peerDependencies: validateStringMap(manifest, 'peerDependencies'),
  };
}

/**
 * Returns deterministic errors for dependency and peer-dependency specifiers
 * that cannot resolve from a published package in a clean consumer. Optional
 * dependencies are excluded because consumers may omit them without violating
 * the required install and runtime contract.
 */
function consumerInvalidDependencyErrors(
  manifest: PackageManifest,
): AuditError[] {
  const errors: AuditError[] = [];
  for (const field of consumerDependencyFields) {
    for (const [name, specifier] of Object.entries(
      manifest[field] ?? {},
    ).sort()) {
      if (invalidDependencyProtocol.test(specifier)) {
        errors.push({
          path: 'package/package.json',
          rule: 'consumer-invalid-dependency',
          message: `${field}.${name} uses consumer-invalid dependency specifier ${specifier}.`,
        });
      }
    }
  }
  return errors;
}

/**
 * Audits every shipped declaration and concrete export target in a tarball.
 * Development-only source conditions are ignored, while wildcard targets are
 * rejected because their shipped members cannot be exhaustively proven and
 * non-relative string targets are rejected as invalid. Missing tarballs,
 * manifest qualification failures, declaration-free packages, and
 * consumer-invalid dependency or peer-dependency protocols produce structured
 * errors rather than throwing.
 */
export async function auditPackedPackage(
  tarball: string,
): Promise<AuditReport> {
  if (!existsSync(tarball)) {
    return {
      errors: [
        {
          path: tarball,
          rule: 'missing-tarball',
          message: 'Packed tarball does not exist.',
        },
      ],
      findings: [],
      scanned: [],
    };
  }
  let members: string[];
  let manifest: PackageManifest;
  try {
    members = tarMembers(tarball);
    manifest = parsePackedManifest(tarball, members);
  } catch (error) {
    return {
      errors: [
        { path: tarball, rule: 'invalid-tarball', message: String(error) },
      ],
      findings: [],
      scanned: [],
    };
  }
  const errors: AuditError[] = [];
  for (const { target } of collectExportTargets(manifest.exports)) {
    if (target.includes('*')) {
      errors.push({
        path: tarball,
        target,
        rule: 'unsupported-wildcard-export-target',
        message: `Unsupported wildcard export target ${target}.`,
      });
      continue;
    }
    if (!isRelativeExportTarget(target)) {
      errors.push({
        path: tarball,
        target,
        rule: 'invalid-export-target',
        message: `Invalid export target ${target}; targets must begin with ./.`,
      });
      continue;
    }
    const member = `package/${target.slice(2)}`;
    if (!members.includes(member)) {
      errors.push({
        path: tarball,
        target,
        rule: 'missing-export-target',
        message: `Missing shipped export target ${target}.`,
      });
    }
  }
  errors.push(...consumerInvalidDependencyErrors(manifest));
  const declarations = members.filter((member) =>
    declarationPattern.test(member),
  );
  if (declarations.length === 0) {
    errors.push({
      path: tarball,
      rule: 'empty-declaration-input',
      message: 'Packed package contains no declarations.',
    });
  }
  return {
    ...scanContents(
      declarations.map((member) => ({
        path: member,
        contents: readTarMember(tarball, member),
      })),
    ),
    errors: sorted(
      errors,
      (error) =>
        `${error.target ?? ''}\0${error.path}\0${error.rule}\0${error.message}`,
    ),
  };
}

/**
 * Classifies concrete consumer imports for root strings, root condition maps,
 * and explicit subpaths. An explicit `types` condition supplies the type
 * entrypoint; otherwise each runtime entrypoint is also imported for TypeScript
 * to resolve an adjacent declaration. Wildcards never reach this function
 * because both packed audit paths reject them rather than pretending one import
 * is exhaustive. A manifest without exports returns empty classifications.
 */
function packageSubpaths(manifest: PackageManifest): {
  runtime: string[];
  types: string[];
} {
  if (!manifest.exports) return { runtime: [], types: [] };
  const exportEntries =
    typeof manifest.exports === 'object' &&
    !Array.isArray(manifest.exports) &&
    Object.keys(manifest.exports).some((key) => key.startsWith('.'))
      ? Object.entries(manifest.exports)
      : [['.', manifest.exports] as const];
  const runtime = new Set<string>();
  const types = new Set<string>();
  for (const [subpath, value] of exportEntries) {
    if (!subpath.startsWith('.') || subpath === './package.json') continue;
    const targets = collectExportTargets(value);
    const hasExplicitTypes = targets.some(
      ({ condition }) => condition === 'types',
    );
    const hasRuntime = targets.some(({ condition }) => condition !== 'types');
    const consumerSubpath =
      subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
    if (hasRuntime) runtime.add(consumerSubpath);
    if (hasExplicitTypes || hasRuntime) types.add(consumerSubpath);
  }
  return {
    runtime: [...runtime].sort(),
    types: [...types].sort(),
  };
}

/**
 * Type-checks the consumer with library checking enabled and returns diagnostics
 * owned by the consumer or packed inputs. Diagnostics owned solely by external
 * dependencies do not make an otherwise valid packed Maelstrom API fail.
 */
function typecheckPackedConsumer(
  consumerRoot: string,
  packageNames: string[],
): string {
  const configPath = join(consumerRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    return ts.formatDiagnostics([config.error], {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => consumerRoot,
      getNewLine: () => '\n',
    });
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    consumerRoot,
    undefined,
    configPath,
  );
  const packagePathMarkers = packageNames.map(
    (name) => `${sep}node_modules${sep}${name.split('/').join(sep)}${sep}`,
  );
  const consumerEntry = join(consumerRoot, 'consumer.ts');
  const diagnostics = [
    ...parsed.errors,
    ...ts.getPreEmitDiagnostics(
      ts.createProgram(parsed.fileNames, parsed.options),
    ),
  ].filter(
    (diagnostic) =>
      diagnostic.category === ts.DiagnosticCategory.Error &&
      (!diagnostic.file ||
        diagnostic.file.fileName === consumerEntry ||
        packagePathMarkers.some((marker) =>
          diagnostic.file?.fileName.includes(marker),
        )),
  );
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => consumerRoot,
    getNewLine: () => '\n',
  });
}

/**
 * Installs packed packages into a clean consumer and checks the type and runtime
 * entrypoints resolved by the configured TypeScript and Bun conditions. It does
 * not execute every branch in a conditional export map. Wildcard targets are
 * rejected because they cannot be exhaustively imported, non-relative string
 * targets are rejected as invalid, and an empty package list returns an error
 * without touching the consumer root. A non-empty package list clears the
 * consumer root before manifest validation. Manifest qualification errors are
 * deterministic and returned before installation, including malformed
 * manifests and consumer-invalid dependency or peer-dependency protocols.
 * After qualification, this check exercises installation and runtime loading,
 * whose errors can include environment-dependent tool output.
 */
export async function installPackedConsumer(
  packages: PackageAuditInput[],
  consumerRoot: string,
): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  if (packages.length === 0)
    return { errors: ['No packed packages were provided to the consumer.'] };
  await rm(consumerRoot, { force: true, recursive: true });
  await mkdir(consumerRoot, { recursive: true });
  const manifests: PackageManifest[] = [];
  for (const package_ of packages) {
    try {
      const members = tarMembers(package_.tarball);
      manifests.push(parsePackedManifest(package_.tarball, members));
    } catch (error) {
      errors.push(`${package_.name}: ${String(error)}`);
    }
  }
  if (errors.length > 0) return { errors: errors.sort() };
  const invalidDependencyErrors = manifests.flatMap((manifest) =>
    consumerInvalidDependencyErrors(manifest).map(
      ({ message }) => `${manifest.name}: ${message}`,
    ),
  );
  if (invalidDependencyErrors.length > 0)
    return { errors: invalidDependencyErrors.sort() };
  const unsupportedWildcardErrors = manifests.flatMap((manifest) =>
    collectExportTargets(manifest.exports)
      .filter(({ target }) => target.includes('*'))
      .map(
        ({ target }) =>
          `${manifest.name} has unsupported wildcard export target ${target}.`,
      ),
  );
  if (unsupportedWildcardErrors.length > 0)
    return { errors: unsupportedWildcardErrors.sort() };
  const invalidExportTargetErrors = manifests.flatMap((manifest) =>
    collectExportTargets(manifest.exports)
      .filter(
        ({ target }) =>
          !target.includes('*') && !isRelativeExportTarget(target),
      )
      .map(
        ({ target }) =>
          `${manifest.name} has invalid export target ${target}; targets must begin with ./.`,
      ),
  );
  if (invalidExportTargetErrors.length > 0)
    return { errors: invalidExportTargetErrors.sort() };
  const dependencies = Object.fromEntries(
    packages
      .map(({ name, tarball }) => [name, `file:${resolve(tarball)}`])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  for (const typePackage of ['@types/node', '@types/react']) {
    try {
      const installed = JSON.parse(
        await readFile(
          resolve(
            import.meta.dir,
            '../../node_modules',
            typePackage,
            'package.json',
          ),
          'utf8',
        ),
      ) as { version: string };
      dependencies[typePackage] = installed.version;
    } catch {
      // The consumer check reports missing types from a shipped declaration.
    }
  }
  for (const manifest of manifests) {
    for (const [peer, range] of Object.entries(
      manifest.peerDependencies ?? {},
    ).sort()) {
      if (dependencies[peer]) continue;
      const installedManifest = resolve(
        import.meta.dir,
        '../../node_modules',
        peer,
        'package.json',
      );
      try {
        const installed = JSON.parse(
          await readFile(installedManifest, 'utf8'),
        ) as { version: string };
        dependencies[peer] = installed.version;
      } catch {
        dependencies[peer] = range;
      }
    }
  }
  await writeFile(
    join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'public-api-docs-consumer',
        private: true,
        type: 'module',
        dependencies,
        overrides: Object.fromEntries(
          packages
            .map(({ name, tarball }) => [name, `file:${resolve(tarball)}`])
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
      },
      null,
      2,
    )}\n`,
  );
  const cache = join(consumerRoot, '.bun-cache');
  const installEnvironment = { BUN_INSTALL_CACHE_DIR: cache };
  for (const arguments_ of [
    ['install', '--ignore-scripts'],
    ['install', '--ignore-scripts', '--frozen-lockfile'],
  ]) {
    const result = run(
      [process.execPath, ...arguments_],
      consumerRoot,
      installEnvironment,
    );
    if (result.exitCode !== 0) {
      errors.push(
        `bun ${arguments_.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`,
      );
      return { errors };
    }
  }
  const classifiedSubpaths = manifests.map(packageSubpaths);
  const typeSubpaths = classifiedSubpaths.flatMap(({ types }) => types);
  const runtimeSubpaths = classifiedSubpaths.flatMap(({ runtime }) => runtime);
  await writeFile(
    join(consumerRoot, 'consumer.ts'),
    `${typeSubpaths.map((subpath, index) => `import type * as Api${index} from '${subpath}';\ntype Check${index} = typeof Api${index};`).join('\n')}\n`,
  );
  await writeFile(
    join(consumerRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: 'ES2022',
        },
        files: ['consumer.ts'],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumerRoot, 'runtime.mjs'),
    `${runtimeSubpaths.map((subpath) => `await import('${subpath}');`).join('\n')}\n`,
  );
  const typecheckErrors = typecheckPackedConsumer(
    consumerRoot,
    manifests.map(({ name }) => name),
  );
  if (typecheckErrors)
    errors.push(`consumer typecheck failed: ${typecheckErrors}`.trim());
  const runtime = run([process.execPath, 'run', 'runtime.mjs'], consumerRoot);
  if (runtime.exitCode !== 0)
    errors.push(
      `consumer runtime imports failed: ${runtime.stderr || runtime.stdout}`.trim(),
    );
  for (const manifest of manifests) {
    if (
      !existsSync(
        join(
          consumerRoot,
          'node_modules',
          ...manifest.name.split('/'),
          'package.json',
        ),
      )
    ) {
      errors.push(
        `${manifest.name} package.json is absent from the installed tarball.`,
      );
    }
  }
  return { errors: errors.sort() };
}

async function discoverPublicPackages(root: string): Promise<PublicPackage[]> {
  const packagesRoot = join(root, 'packages');
  const packages: PublicPackage[] = [];
  for (const entry of (
    await readdir(packagesRoot, { withFileTypes: true })
  ).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const directory = join(packagesRoot, entry.name);
    try {
      const manifest = JSON.parse(
        await readFile(join(directory, 'package.json'), 'utf8'),
      ) as PackageManifest;
      if (manifest.publishConfig?.access === 'public')
        packages.push({ directory, manifest });
    } catch {
      // Directories without a package manifest are not package projects.
    }
  }
  return packages;
}

async function filesRecursively(
  root: string,
  extensions: string[],
): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (extensions.some((extension) => path.endsWith(extension)))
        files.push(path);
    }
  };
  await visit(root);
  return files;
}

async function packPackage(
  package_: PublicPackage,
  destination: string,
): Promise<string> {
  await rm(destination, { force: true, recursive: true });
  await mkdir(destination, { recursive: true });
  const result = run(
    [
      process.execPath,
      'pm',
      'pack',
      '--ignore-scripts',
      '--destination',
      destination,
    ],
    package_.directory,
  );
  if (result.exitCode !== 0)
    throw new Error(
      `Packing ${package_.manifest.name} failed: ${result.stderr || result.stdout}`,
    );
  const created = (await readdir(destination))
    .filter((file) => file.endsWith('.tgz'))
    .sort();
  if (created.length !== 1)
    throw new Error(
      `Packing ${package_.manifest.name} created ${created.length} tarballs.`,
    );
  return join(destination, created[0]);
}

function auditPackageBuildOutputs(packages: PublicPackage[]): AuditReport {
  const errors: AuditError[] = [];
  for (const package_ of packages) {
    const targets = new Set(
      collectExportTargets(package_.manifest.exports)
        .map(({ target }) => target)
        .filter(
          (target) => !target.includes('*') && isRelativeExportTarget(target),
        ),
    );
    for (const target of [...targets].sort()) {
      if (existsSync(join(package_.directory, target.slice(2)))) continue;
      errors.push({
        path: `${package_.manifest.name}:${target}`,
        rule: 'missing-package-build-output',
        message: `Package build output ${target} does not exist; build ${package_.manifest.name} before running the declaration audit.`,
        target,
      });
    }
  }
  return { errors, findings: [], scanned: [] };
}

function mergeReports(reports: AuditReport[]): AuditReport {
  return {
    errors: sorted(
      reports.flatMap(({ errors }) => errors),
      (error) => `${error.path}\0${error.rule}\0${error.message}`,
    ),
    findings: sorted(
      reports.flatMap(({ findings }) => findings),
      (finding) =>
        `${finding.path}\0${finding.line.toString().padStart(8, '0')}\0${finding.rule}`,
    ),
    scanned: reports.flatMap(({ scanned }) => scanned).sort(),
  };
}

/**
 * Runs the selected audits and returns a process exit code. Invalid CLI option
 * combinations remain usage errors on stderr with exit code 2; unmet artifact
 * prerequisites and audit findings are emitted in the JSON report and return
 * exit code 1.
 */
async function main(): Promise<number> {
  const root = resolve(import.meta.dir, '../..');
  const arguments_ = process.argv.slice(2);
  const declarations = arguments_.includes('--declarations');
  const typedoc = arguments_.includes('--typedoc');
  const packedConsumer = arguments_.includes('--packed-consumer');
  const reportArgument = arguments_.find((argument) =>
    argument.startsWith('--report='),
  );
  const packageArgument = arguments_.find((argument) =>
    argument.startsWith('--packages='),
  );
  const selectedNames = packageArgument
    ? new Set(packageArgument.slice('--packages='.length).split(','))
    : undefined;
  if (packedConsumer && !declarations) {
    console.error('--packed-consumer requires --declarations.');
    return 2;
  }
  if (!declarations && !typedoc) {
    console.error('Specify --declarations and/or --typedoc.');
    return 2;
  }
  if (packageArgument && !declarations) {
    console.error(
      '--packages requires --declarations; TypeDoc artifacts are audited as one unfiltered set.',
    );
    return 2;
  }
  const discovered = declarations ? await discoverPublicPackages(root) : [];
  const unknownSelectedNames = selectedNames
    ? [...selectedNames]
        .filter(
          (name) => !discovered.some(({ manifest }) => manifest.name === name),
        )
        .sort()
    : [];
  if (unknownSelectedNames.length > 0) {
    console.error(
      `Unknown public package selection: ${unknownSelectedNames.join(', ')}.`,
    );
    return 2;
  }
  const reports: AuditReport[] = [];
  const consumerErrors: string[] = [];
  const tempRoot = declarations
    ? await mkdtemp(join(tmpdir(), 'maelstrom-public-api-docs-'))
    : undefined;
  try {
    if (declarations) {
      const selected = selectedNames
        ? discovered.filter(({ manifest }) => selectedNames.has(manifest.name))
        : discovered;
      if (selected.length === 0) {
        reports.push({
          errors: [
            {
              path: 'packages',
              rule: 'empty-package-input',
              message: 'No public packages matched.',
            },
          ],
          findings: [],
          scanned: [],
        });
      } else {
        if (!tempRoot) throw new Error('Missing declaration audit workspace.');
        const buildOutputReport = auditPackageBuildOutputs(selected);
        if (buildOutputReport.errors.length > 0) {
          reports.push(buildOutputReport);
        } else {
          const tarballRoot = join(tempRoot, 'tarballs');
          const packed: PackageAuditInput[] = [];
          for (const package_ of selected) {
            const tarball = await packPackage(
              package_,
              join(tarballRoot, package_.manifest.name.replaceAll('/', '-')),
            );
            packed.push({ name: package_.manifest.name, tarball });
            const report = await auditPackedPackage(tarball);
            report.errors = report.errors.map((error) => ({
              ...error,
              path: `${package_.manifest.name}:${error.path}`,
            }));
            report.findings = report.findings.map((finding) => ({
              ...finding,
              path: `${package_.manifest.name}:${finding.path}`,
            }));
            report.scanned = report.scanned.map(
              (path) => `${package_.manifest.name}:${path}`,
            );
            reports.push(report);
          }
          if (packedConsumer) {
            consumerErrors.push(
              ...(
                await installPackedConsumer(packed, join(tempRoot, 'consumer'))
              ).errors,
            );
          }
        }
      }
    }
    if (typedoc) {
      const generatedRootPath = 'apps/docs/dist/reference';
      const generatedFiles = await filesRecursively(
        join(root, generatedRootPath),
        ['.html'],
      );
      if (generatedFiles.length === 0) {
        reports.push({
          errors: [
            {
              path: generatedRootPath,
              rule: 'missing-typedoc-html',
              message:
                'Generated TypeDoc output contains no HTML; build the documentation site before running the TypeDoc audit.',
            },
          ],
          findings: [],
          scanned: [],
        });
      } else {
        const sourceFiles = await filesRecursively(
          join(root, 'apps/docs/src/content/docs/reference'),
          ['.md'],
        );
        reports.push(
          await auditArtifactFiles([...sourceFiles, ...generatedFiles]),
        );
      }
    }
    const merged = mergeReports(reports);
    for (const message of consumerErrors) {
      merged.errors.push({
        path: 'packed-consumer',
        rule: 'consumer-check-failed',
        message,
      });
    }
    merged.errors = sorted(
      merged.errors,
      (error) => `${error.path}\0${error.rule}\0${error.message}`,
    );
    const output = `${JSON.stringify(merged, null, 2)}\n`;
    if (reportArgument) {
      const reportPath = resolve(reportArgument.slice('--report='.length));
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, output);
    }
    process.stdout.write(output);
    return merged.errors.length > 0 || merged.findings.length > 0 ? 1 : 0;
  } finally {
    if (tempRoot) await rm(tempRoot, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
