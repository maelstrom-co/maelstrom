import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

describe('shared agent guidance', () => {
  test('keeps every coding tool on one rule set', async () => {
    const claude = await readFile(join(root, 'CLAUDE.md'), 'utf8');
    expect(claude.trim()).toBe('@AGENTS.md');

    const openCode = JSON.parse(
      await readFile(join(root, 'opencode.json'), 'utf8'),
    );
    expect(openCode).not.toHaveProperty('instructions');
    expect(openCode).not.toHaveProperty('model');
  });
});
