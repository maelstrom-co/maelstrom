import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from 'js-yaml';
import * as semver from 'semver';

/** SDK package compatibility declarations for a canonical prompt. */
export interface PromptCompatibility {
  /** Non-empty mapping from SDK package names to semver ranges. */
  sdk: Record<string, string>;
}

/** Metadata validated for a canonical prompt. */
export interface PromptMetadata {
  /** Stable lowercase kebab-case identity for the prompt. */
  id: string;
  /** Stable semantic version for the complete prompt body. */
  prompt_version: string;
  /** SDK package compatibility declarations. */
  compatibility: PromptCompatibility;
}

/** A canonical prompt with frontmatter separated from its copyable body. */
export interface PromptSource {
  /** Validated prompt metadata. */
  metadata: PromptMetadata;
  /** Complete Markdown body with a trailing newline and no frontmatter. */
  body: string;
  /** Source filename, used only for diagnostics and discovery. */
  filename: string;
}

/** Parses one canonical prompt source and returns its validated metadata and body. */
export function parsePromptSource(
  source: string,
  filename = '<prompt>',
): PromptSource {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match)
    throw new Error(`${filename}: expected YAML frontmatter delimited by ---`);

  let metadata: unknown;
  try {
    metadata = load(match[1], { json: false });
  } catch (error) {
    throw new Error(
      `${filename}: invalid YAML frontmatter: ${errorMessage(error)}`,
    );
  }
  validateMetadata(metadata, filename);

  let body = source.slice(match[0].length);
  if (!body.endsWith('\n')) body += '\n';
  return { metadata, body, filename };
}

/** Loads and validates all Markdown prompt sources from a directory. */
export async function loadPromptLibrary(
  directory: string,
): Promise<PromptSource[]> {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith('.md'))
    .sort();
  const prompts = await Promise.all(
    names.map(async (filename) =>
      parsePromptSource(
        await readFile(join(directory, filename), 'utf8'),
        filename,
      ),
    ),
  );
  const ids = new Set<string>();
  for (const prompt of prompts) {
    if (ids.has(prompt.metadata.id))
      throw new Error(`duplicate prompt id: ${prompt.metadata.id}`);
    ids.add(prompt.metadata.id);
  }
  return prompts;
}

/** Validates prompt metadata against the locked P0 schema. */
export function validateMetadata(
  value: unknown,
  filename = '<prompt>',
): asserts value is PromptMetadata {
  const fail = (message: string): never => {
    throw new Error(`${filename}: ${message}`);
  };
  if (!isRecord(value)) fail('frontmatter must be a mapping');
  const record = value as Record<string, unknown>;
  exactKeys(record, ['id', 'prompt_version', 'compatibility'], fail);
  if (
    typeof record.id !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id)
  ) {
    fail('id must be lowercase kebab-case');
  }
  if (
    typeof record.prompt_version !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(record.prompt_version) ||
    !semver.valid(record.prompt_version)
  ) {
    fail('prompt_version must be a stable semantic version');
  }
  if (!isRecord(record.compatibility)) fail('compatibility must be a mapping');
  const compatibility = record.compatibility as Record<string, unknown>;
  exactKeys(compatibility, ['sdk'], fail);
  const sdk = compatibility.sdk;
  if (!isRecord(sdk) || Object.keys(sdk).length === 0)
    fail('compatibility.sdk must be a non-empty mapping');
  const sdkRecord = sdk as Record<string, unknown>;
  for (const [name, range] of Object.entries(sdkRecord)) {
    if (
      !name.trim() ||
      typeof range !== 'string' ||
      !range.trim() ||
      !semver.validRange(range)
    ) {
      fail(
        `invalid SDK compatibility range for ${name || '<empty package name>'}`,
      );
    }
  }
}

/** Returns whether an SDK version satisfies a declared range, including prereleases only when explicitly admitted. */
export function sdkVersionMatches(version: string, range: string): boolean {
  if (!semver.valid(version) || !semver.validRange(range)) return false;
  return semver.satisfies(version, range);
}

function exactKeys(
  record: Record<string, unknown>,
  expected: string[],
  fail: (message: string) => never,
): void {
  for (const key of Object.keys(record))
    if (!expected.includes(key)) fail(`unknown field ${key}`);
  for (const key of expected)
    if (!(key in record)) fail(`missing required field ${key}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
