import { describe, expect, test } from 'bun:test';
import {
  PRODUCTION_RATE_LIMIT,
  PRODUCTION_RATE_LIMIT_RULES,
} from '../src/RateLimitContract.js';
import { WAITLIST_DISCORD_INVITE_URL } from '../src/WaitlistContract.js';

const stackSource = await Bun.file(
  new URL('../alchemy.run.ts', import.meta.url),
).text();
const zoneSource = await Bun.file(
  new URL('../src/Zone.ts', import.meta.url),
).text();
const rateLimitSource = await Bun.file(
  new URL('../src/RateLimit.ts', import.meta.url),
).text();
const rateLimitContractSource = await Bun.file(
  new URL('../src/RateLimitContract.ts', import.meta.url),
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
  test('keeps the public beta community invite in the shared waitlist contract', () => {
    expect(WAITLIST_DISCORD_INVITE_URL).toBe('https://discord.gg/XAjJqrF2u3');
  });

  test('keeps the deployed stack identity and waitlist logical IDs stable', () => {
    expect(stackSource).toContain('MaelstromPlatform.make');
    expect(waitlistSource).toContain("D1.Database('Waitlist'");
    expect(waitlistSource).toContain("D1.Database('WaitlistNext'");
    expect(waitlistSource).toContain("'NotificationsEmail'");
    expect(waitlistSource).toContain("'WaitlistTurnstile'");
  });

  test('keeps the exact production zone identity retained without temporary adoption', () => {
    expect(zoneSource).toContain(`Cloudflare.Zone.Zone('ProductionZone', {
  name: 'maelstrom-ai.co',
  type: 'full',
  paused: false,
  vanityNameServers: [],
}).pipe(retain(true));`);
    expect(zoneSource).not.toContain('adopt');
    expect(stackSource).not.toContain('adopt');
  });

  test('owns and retains the complete production rate-limit phase in exact order', () => {
    expect(PRODUCTION_RATE_LIMIT).toEqual({
      logicalId: 'ProductionRateLimit',
      rulesetId: '189a3c2125bc40c2b9565ae2268587ed',
      zoneId: '4df25ea08d364f19471be7a179ce9f02',
      kind: 'zone',
      name: 'default',
      phase: 'http_ratelimit',
      description: '',
    });
    expect(PRODUCTION_RATE_LIMIT_RULES).toEqual([
      {
        id: '0bbc7a5acc5d4f66b7a034567dc802b1',
        ref: '0bbc7a5acc5d4f66b7a034567dc802b1',
        action: 'block',
        description: 'Leaked credential check',
        enabled: true,
        expression: '(cf.waf.credential_check.password_leaked)',
        ratelimit: {
          characteristics: ['ip.src', 'cf.colo.id'],
          period: 10,
          requestsPerPeriod: 5,
          mitigationTimeout: 3600,
        },
      },
      {
        id: 'a38e81b4bcbe4f08953aaf7028b44b2f',
        ref: 'a38e81b4bcbe4f08953aaf7028b44b2f',
        action: 'managed_challenge',
        description: 'Rate limit waitlist signup',
        enabled: true,
        expression:
          '((http.request.uri.path eq "/api/waitlist") or (http.request.uri.path eq "/api/waitlist/confirm") or (http.request.uri.path eq "/api/waitlist/resend"))',
        ratelimit: {
          characteristics: ['ip.src', 'cf.colo.id'],
          period: 60,
          requestsPerPeriod: 10,
          mitigationTimeout: 0,
        },
      },
    ]);
    expect(rateLimitSource).toContain('Cloudflare.Ruleset.Ruleset(');
    expect(rateLimitSource).toContain('PRODUCTION_RATE_LIMIT_RULES.map');
    expect(rateLimitSource).toContain('.pipe(retain(true))');
    expect(rateLimitSource).not.toContain('adopt');
    expect(rateLimitContractSource).not.toMatch(/from ['"]/);
  });

  test('declares the retained phase owner after its zone and before platform resources', () => {
    const zonePosition = stackSource.indexOf('yield* ProductionZone');
    const rulesetPosition = stackSource.indexOf(
      'yield* ProductionRateLimit(zone)',
    );
    const waitlistPosition = stackSource.indexOf('yield* WaitlistPlatform');
    expect(zonePosition).toBeGreaterThanOrEqual(0);
    expect(rulesetPosition).toBeGreaterThan(zonePosition);
    expect(waitlistPosition).toBeGreaterThan(rulesetPosition);
    expect(stackSource).not.toContain('Cloudflare.Ruleset.Ruleset(');
  });

  test('cannot mutate application Workers', () => {
    expect(stackSource).not.toContain('Cloudflare.Worker');
    expect(stackSource).not.toContain('Cloudflare.Website');
    expect(waitlistSource).not.toContain('Cloudflare.Worker');
    expect(waitlistSource).not.toContain('Cloudflare.Website');
  });

  test('exports platform resources as references for application stacks', () => {
    expect(waitlistSource).toContain("D1.Database.ref('WaitlistNext'");
    expect(waitlistSource).toContain('Turnstile.Widget.ref(');
  });

  test('retains subscriber data, sender configuration, and bot protection', () => {
    expect(waitlistSource.match(/retain\(true\)/g)).toHaveLength(4);
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
    expect(stackSource).not.toContain('adopt(true)');
    expect(zoneSource).not.toContain('adopt(true)');
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
