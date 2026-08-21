import { describe, expect, test } from 'bun:test';

const stackSource = await Bun.file(
  new URL('../platform.run.ts', import.meta.url),
).text();
const migration = await Bun.file(
  new URL('../migrations/0001_create_waitlist.sql', import.meta.url),
).text();

describe('waitlist platform contract', () => {
  test('cannot mutate any application Worker during provisioning', () => {
    expect(stackSource).not.toContain('Cloudflare.Worker');
    expect(stackSource).not.toContain('Cloudflare.Website');
  });

  test('retains subscriber data, sender configuration, and bot protection', () => {
    expect(stackSource.match(/retain\(true\)/g)).toHaveLength(3);
  });

  test('adopts the existing Turnstile widget without rotating its keys', () => {
    expect(stackSource).toContain('Cloudflare.Turnstile.Widget(');
    expect(stackSource).toContain('adopt(true)');
  });

  test('stores confirmation token hashes instead of reusable tokens', () => {
    expect(migration).toContain('confirmation_token_hash TEXT');
    expect(migration).not.toMatch(/confirmation_token\s+TEXT/);
  });

  test('models the double-opt-in lifecycle explicitly', () => {
    expect(migration).toContain("'pending', 'confirmed', 'unsubscribed'");
    expect(migration).toContain('confirmation_expires_at TEXT');
    expect(migration).toContain('confirmed_at TEXT');
    expect(migration).toContain('unsubscribed_at TEXT');
  });
});
