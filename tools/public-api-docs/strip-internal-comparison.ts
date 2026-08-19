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
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

import { discoverPublishablePackages } from './package-discovery';

export type StripInternalStatus =
  | 'identical'
  | 'drift-rejected'
  | 'not-applicable';

export interface StripInternalResult {
  status: StripInternalStatus;
  changedFiles: string[];
  inputCount: number;
}

async function declarationFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/\.d\.(?:ts|mts|cts)$/.test(path)) files.push(path);
    }
  };
  await visit(root);
  return files;
}

function compilerConfiguration(
  tsconfig: string,
  outDir: string,
  stripInternal: boolean,
): ts.ParsedCommandLine {
  const config = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (config.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, '\n'),
    );
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(tsconfig),
    {
      allowImportingTsExtensions: true,
      declaration: true,
      declarationMap: false,
      emitDeclarationOnly: true,
      noEmit: false,
      outDir,
      stripInternal,
      tsBuildInfoFile: join(outDir, '.tsbuildinfo'),
    },
    tsconfig,
  );
  if (parsed.errors.length > 0) {
    throw new Error(ts.formatDiagnostics(parsed.errors, diagnosticHost));
  }
  return parsed;
}

const diagnosticHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine,
};

async function emit(
  tsconfig: string,
  outDir: string,
  stripInternal: boolean,
): Promise<number> {
  const configuration = compilerConfiguration(tsconfig, outDir, stripInternal);
  if (configuration.fileNames.length === 0) return 0;
  const program = ts.createProgram(
    configuration.fileNames,
    configuration.options,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const result = program.emit();
  const errors = [...diagnostics, ...result.diagnostics].filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (result.emitSkipped || errors.length > 0) {
    throw new Error(ts.formatDiagnostics(errors, diagnosticHost));
  }
  return configuration.fileNames.length;
}

export async function compareStripInternal(
  tsconfig: string,
  outputRoot: string,
): Promise<StripInternalResult> {
  const ordinary = join(outputRoot, 'ordinary');
  const stripped = join(outputRoot, 'stripped');
  await Promise.all([
    rm(ordinary, { force: true, recursive: true }),
    rm(stripped, { force: true, recursive: true }),
  ]);
  await mkdir(ordinary, { recursive: true });
  await mkdir(stripped, { recursive: true });
  const inputCount = await emit(tsconfig, ordinary, false);
  if (inputCount === 0)
    return { status: 'not-applicable', changedFiles: [], inputCount };
  await emit(tsconfig, stripped, true);
  const ordinaryFiles = await declarationFiles(ordinary);
  const strippedFiles = await declarationFiles(stripped);
  if (ordinaryFiles.length === 0 || strippedFiles.length === 0) {
    throw new Error(
      `Declaration emit produced an empty output for ${tsconfig}.`,
    );
  }
  const paths = new Set([
    ...ordinaryFiles.map((path) => relative(ordinary, path)),
    ...strippedFiles.map((path) => relative(stripped, path)),
  ]);
  const changedFiles: string[] = [];
  for (const path of [...paths].sort()) {
    const ordinaryPath = join(ordinary, path);
    const strippedPath = join(stripped, path);
    const ordinaryContents = existsSync(ordinaryPath)
      ? await readFile(ordinaryPath, 'utf8')
      : undefined;
    const strippedContents = existsSync(strippedPath)
      ? await readFile(strippedPath, 'utf8')
      : undefined;
    if (ordinaryContents !== strippedContents) changedFiles.push(path);
  }
  return {
    status: changedFiles.length === 0 ? 'identical' : 'drift-rejected',
    changedFiles,
    inputCount,
  };
}

async function main(): Promise<number> {
  const root = resolve(import.meta.dir, '../..');
  const arguments_ = process.argv.slice(2);
  const reportArgument = arguments_.find((argument) =>
    argument.startsWith('--report='),
  );
  const packageArgument = arguments_.find((argument) =>
    argument.startsWith('--packages='),
  );
  const selected = packageArgument
    ? new Set(packageArgument.slice('--packages='.length).split(','))
    : undefined;
  const packages = (await discoverPublishablePackages(root)).filter(
    ({ directory }) => existsSync(join(directory, 'tsconfig.lib.json')),
  );
  const publicPackageNames = packages.map(({ manifest }) => manifest.name);
  const unknownSelectedNames = selected
    ? [...selected].filter((name) => !publicPackageNames.includes(name)).sort()
    : [];
  if (unknownSelectedNames.length > 0) {
    console.error(
      `Unknown public package selection: ${unknownSelectedNames.join(', ')}.`,
    );
    return 2;
  }
  const workspace = await mkdtemp(join(tmpdir(), 'maelstrom-strip-internal-'));
  try {
    const results: Array<{ package: string; result: StripInternalResult }> = [];
    for (const { directory, manifest } of packages) {
      if (selected && !selected.has(manifest.name)) continue;
      const result = await compareStripInternal(
        join(directory, 'tsconfig.lib.json'),
        join(workspace, manifest.name.replaceAll('/', '-')),
      );
      results.push({ package: manifest.name, result });
    }
    if (results.length === 0)
      throw new Error('No public package declaration inputs matched.');
    const output = `${JSON.stringify({ results }, null, 2)}\n`;
    if (reportArgument) {
      const reportPath = resolve(reportArgument.slice('--report='.length));
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, output);
    }
    process.stdout.write(output);
    return 0;
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
