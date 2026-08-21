import { describe, expect, test } from 'bun:test';

const stackSource = await Bun.file(
  new URL('../alchemy.run.ts', import.meta.url),
).text();
const waitlistSource = await Bun.file(
  new URL('../src/Waitlist.ts', import.meta.url),
).text();
const migration = await Bun.file(
  new URL('../migrations/0001_create_waitlist.sql', import.meta.url),
).text();

describe('platform stack contract', () => {
  test('keeps the deployed stack identity and waitlist logical IDs stable', () => {
    expect(stackSource).toContain('MaelstromPlatform.make');
    expect(waitlistSource).toContain("D1.Database('Waitlist'");
    expect(waitlistSource).toContain("'NotificationsEmail'");
    expect(waitlistSource).toContain("'WaitlistTurnstile'");
  });

  test('cannot mutate application Workers', () => {
    expect(stackSource).not.toContain('Cloudflare.Worker');
    expect(stackSource).not.toContain('Cloudflare.Website');
    expect(waitlistSource).not.toContain('Cloudflare.Worker');
    expect(waitlistSource).not.toContain('Cloudflare.Website');
  });

  test('exports platform resources as references for application stacks', () => {
    expect(waitlistSource).toContain("D1.Database.ref('Waitlist'");
    expect(waitlistSource).toContain('Turnstile.Widget.ref(');
  });

  test('retains subscriber data, sender configuration, and bot protection', () => {
    expect(waitlistSource.match(/retain\(true\)/g)).toHaveLength(3);
  });

  test('does not hide resource takeover inside declarations', () => {
    expect(waitlistSource).not.toContain('adopt(true)');
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
