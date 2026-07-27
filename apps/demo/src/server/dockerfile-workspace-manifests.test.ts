import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

/** Root package.json's "workspaces" globs are always `<dir>/*`, one level deep. */
function workspaceMembers(globs: readonly string[]): string[] {
  const members: string[] = [];
  for (const glob of globs) {
    const groupDir = glob.replace(/\/\*$/, '');
    for (const entry of readdirSync(join(repoRoot, groupDir), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const relPath = `${groupDir}/${entry.name}`;
      if (existsSync(join(repoRoot, relPath, 'package.json'))) {
        members.push(relPath);
      }
    }
  }
  return members;
}

/**
 * Manifest-only COPYs look like `COPY apps/docs/package.json apps/docs/package.json`,
 * optionally with a `--chown=user:group` flag between `COPY` and the paths.
 */
function dockerfileManifestMembers(dockerfile: string): string[] {
  const members: string[] = [];
  for (const line of dockerfile.split('\n')) {
    const match =
      /^COPY\s+(?:--chown=\S+\s+)?(\S+)\/package\.json\s+\S+\/package\.json\s*$/.exec(
        line.trim(),
      );
    if (match) members.push(match[1]);
  }
  return members;
}

/**
 * Full-directory COPYs look like `COPY packages packages` or
 * `COPY apps/demo apps/demo` -- source and destination are the same
 * directory, neither ends in `package.json`, and there's an optional
 * `--chown=user:group` flag between `COPY` and the paths.
 */
function dockerfileFullSourceDirs(dockerfile: string): string[] {
  const dirs: string[] = [];
  for (const line of dockerfile.split('\n')) {
    const match = /^COPY\s+(?:--chown=\S+\s+)?(\S+)\s+(\S+)\s*$/.exec(
      line.trim(),
    );
    if (match && match[1] === match[2] && !match[1].endsWith('package.json')) {
      dirs.push(match[1]);
    }
  }
  return dirs;
}

describe('apps/demo/Dockerfile manifest COPY list', () => {
  it('stages every workspace member package.json, so bun install --frozen-lockfile does not fail on an unresolved workspace dependency', () => {
    // A workspace member's package.json reaches `bun install` either via a
    // manifest-only COPY (members whose full source isn't needed at
    // runtime -- apps/docs, apps/www, tools/*) or because a full-directory
    // COPY carries its real source, and with it, its package.json (apps/demo,
    // every packages/* member -- these are needed at runtime because the
    // CMD's `--conditions @maelstrom-co/source` resolves @maelstrom-co/*
    // imports straight to packages/*/src, and apps/demo is the app itself).
    const rootPackageJson = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
    ) as { workspaces: string[] };
    const dockerfile = readFileSync(
      join(repoRoot, 'apps/demo/Dockerfile'),
      'utf-8',
    );

    const actualMembers = workspaceMembers(rootPackageJson.workspaces);
    const manifestOnlyMembers = dockerfileManifestMembers(dockerfile);
    const fullSourceDirs = dockerfileFullSourceDirs(dockerfile);

    const coveredMembers = new Set(manifestOnlyMembers);
    for (const member of actualMembers) {
      if (
        fullSourceDirs.some(
          (dir) => member === dir || member.startsWith(`${dir}/`),
        )
      ) {
        coveredMembers.add(member);
      }
    }

    expect(coveredMembers).toEqual(new Set(actualMembers));
  });
});
