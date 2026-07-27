import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHARDS, shardInstanceName } from './shard';

// Strips `//` line comments from wrangler.jsonc so it can be parsed with
// JSON.parse. String-aware (won't treat a `//` inside a quoted value, e.g. a
// URL, as a comment) -- a naive regex strip would be wrong for that case.
function stripJsonComments(text: string): string {
  let result = '';
  let inString = false;
  let inComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inComment) {
      if (ch === '\n') {
        inComment = false;
        result += ch;
      }
      continue;
    }
    if (inString) {
      result += ch;
      if (ch === '\\') {
        result += text[i + 1];
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      inComment = true;
      i++;
      continue;
    }
    result += ch;
  }
  return result;
}

describe('SHARDS', () => {
  it('matches wrangler.jsonc max_instances, so a hash bucket is never provisioned dead or overflowing', () => {
    const wranglerPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../wrangler.jsonc',
    );
    const raw = readFileSync(wranglerPath, 'utf-8');
    const config = JSON.parse(stripJsonComments(raw)) as {
      containers: readonly { max_instances: number }[];
    };
    expect(SHARDS).toBe(config.containers[0]?.max_instances);
  });
});

describe('shardInstanceName', () => {
  it('is stable across repeated calls for the same session (reconnects must land on the same container)', () => {
    const first = shardInstanceName('visitor-abc123');
    const second = shardInstanceName('visitor-abc123');
    expect(second).toBe(first);
  });

  it('never returns a shard outside 0..SHARDS-1', () => {
    const sessions = [
      '',
      'a',
      'session-V1StGXR8_Z5jdHi6B-myT',
      'session-🎉unicode',
      'x'.repeat(500),
    ];
    for (const session of sessions) {
      const name = shardInstanceName(session);
      const match = /^shard-(\d+)$/.exec(name);
      expect(match).not.toBeNull();
      const index = Number(match?.[1]);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(SHARDS);
    }
  });

  it('does not throw and still returns a deterministic bucket for an empty/missing session', () => {
    // A keyless visitor's first frames arrive before any playground.hello,
    // so the worker may see no `session` query param at all.
    expect(() => shardInstanceName('')).not.toThrow();
    expect(shardInstanceName('')).toBe(shardInstanceName(''));
  });

  it('spreads a realistic population of nanoid-shaped sessionIds across more than one shard', () => {
    // A hash that always landed everything on one bucket would defeat the
    // whole point of sharding but could still pass the narrower invariants
    // above -- this is the test that actually exercises the hash function.
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    function fakeNanoid(seed: number): string {
      let s = seed;
      let out = '';
      for (let i = 0; i < 21; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        out += alphabet[s % alphabet.length];
      }
      return `session-${out}`;
    }

    const buckets = new Set<string>();
    for (let i = 0; i < 200; i++) {
      buckets.add(shardInstanceName(fakeNanoid(i)));
    }
    expect(buckets.size).toBeGreaterThan(1);
  });
});
