import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { requireExpectedAccount } from '../src/Stage.js';

const runGuard = (environment: Record<string, string>) => {
  const previous = {
    EXPECTED_CLOUDFLARE_ACCOUNT_ID: process.env.EXPECTED_CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
  };
  for (const [name, value] of Object.entries(environment)) {
    process.env[name] = value;
  }
  return Effect.runPromiseExit(requireExpectedAccount('test scope')).finally(
    () => {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    },
  );
};

describe('requireExpectedAccount', () => {
  test('skips the check when no expectation is configured', async () => {
    const exit = await runGuard({});
    expect(exit._tag).toBe('Success');
  });

  test('passes when the active account matches the expectation', async () => {
    const exit = await runGuard({
      EXPECTED_CLOUDFLARE_ACCOUNT_ID: 'acct-prod',
      CLOUDFLARE_ACCOUNT_ID: 'acct-prod',
    });
    expect(exit._tag).toBe('Success');
  });

  test('dies when the active account differs from the expectation', async () => {
    const exit = await runGuard({
      EXPECTED_CLOUDFLARE_ACCOUNT_ID: 'acct-prod',
      CLOUDFLARE_ACCOUNT_ID: 'acct-preview',
    });
    expect(exit._tag).toBe('Failure');
  });

  test('dies when the active account is missing while one is expected', async () => {
    const exit = await runGuard({
      EXPECTED_CLOUDFLARE_ACCOUNT_ID: 'acct-prod',
    });
    expect(exit._tag).toBe('Failure');
  });
});
