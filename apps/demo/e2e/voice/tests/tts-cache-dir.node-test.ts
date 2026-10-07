import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { resolveTtsCacheDir } from '../tts-cache-dir.ts';

test('uses and creates the XDG cache outside the repository', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'voice-cache-test-'));
  const repositoryRoot = join(temporaryRoot, 'repo');
  const xdgCacheHome = join(temporaryRoot, 'cache');
  try {
    await mkdir(repositoryRoot);
    const cache = await resolveTtsCacheDir(repositoryRoot, {
      xdgCacheHome,
      workingDirectory: temporaryRoot,
    });
    assert.equal(cache, join(xdgCacheHome, 'tts2mic-mcp'));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('rejects a cache path inside the repository, including symlinks', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'voice-cache-test-'));
  const repositoryRoot = join(temporaryRoot, 'repo');
  const insideRepository = join(repositoryRoot, '.cache');
  const symlinkPath = join(temporaryRoot, 'cache-link');
  try {
    await mkdir(repositoryRoot);
    await assert.rejects(
      resolveTtsCacheDir(repositoryRoot, {
        override: insideRepository,
        workingDirectory: temporaryRoot,
      }),
      /outside the repository/,
    );
    await symlink(insideRepository, symlinkPath, 'dir');
    await assert.rejects(
      resolveTtsCacheDir(repositoryRoot, {
        override: symlinkPath,
        workingDirectory: temporaryRoot,
      }),
      /outside the repository/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
