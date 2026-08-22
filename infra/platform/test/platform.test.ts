import { describe, expect, test } from 'bun:test';

const stackSource = await Bun.file(
  new URL('../alchemy.run.ts', import.meta.url),
).text();
const zoneSource = await Bun.file(
  new URL('../src/Zone.ts', import.meta.url),
).text();
const waitlistSource = await Bun.file(
  new URL('../src/Waitlist.ts', import.meta.url),
).text();
const waitlistContractSource = await Bun.file(
  new URL('../src/WaitlistContract.ts', import.meta.url),
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

  test('bootstraps only the exact retained production zone identity', () => {
    expect(zoneSource).toContain(`Cloudflare.Zone.Zone('ProductionZone', {
  name: 'maelstrom-ai.co',
  type: 'full',
  paused: false,
  vanityNameServers: [],
}).pipe(retain(true));`);
    expect(zoneSource).not.toContain('adopt(');
    expect(zoneSource).not.toContain('Ruleset');
  });

  test('declares the production zone before platform resources and future rulesets', () => {
    const zonePosition = stackSource.indexOf('yield* ProductionZone');
    const waitlistPosition = stackSource.indexOf('yield* WaitlistPlatform');
    expect(zonePosition).toBeGreaterThanOrEqual(0);
    expect(waitlistPosition).toBeGreaterThan(zonePosition);
    expect(stackSource).not.toContain('Ruleset');
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
    expect(waitlistSource).toContain('WAITLIST_PRODUCTION_HOSTNAMES');
    expect(waitlistSource).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  test('keeps the browser and infrastructure waitlist contract dependency-free', () => {
    expect(waitlistContractSource).toContain(
      "export const WAITLIST_TURNSTILE_ACTION = 'turnstile-spin-v1'",
    );
    expect(waitlistContractSource).toContain("'maelstrom-ai.co'");
    expect(waitlistContractSource).toContain("'www.maelstrom-ai.co'");
    expect(waitlistContractSource).toContain(
      "export const WAITLIST_ORIGIN = 'https://maelstrom-ai.co'",
    );
    expect(waitlistContractSource).toContain(
      'export const WAITLIST_SENDER_ADDRESS =',
    );
    expect(waitlistContractSource).not.toMatch(
      /from ['"](?:alchemy|effect|node:)/,
    );
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
