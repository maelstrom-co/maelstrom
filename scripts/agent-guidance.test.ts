import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

describe('shared agent guidance', () => {
  test('keeps Claude on the shared project rules', async () => {
    const claude = await readFile(join(root, 'CLAUDE.md'), 'utf8');
    expect(claude.trim()).toBe('@AGENTS.md');
  });
});
