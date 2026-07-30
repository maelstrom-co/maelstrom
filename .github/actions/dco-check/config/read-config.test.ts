import { describe, expect, it } from 'bun:test';
import { readConfig } from './read-config.ts';

describe('readConfig', () => {
  it('reads a same-repository pull request as not a fork', () => {
    expect(withEnv({ HEAD_REPOSITORY: 'maelstrom-co/maelstrom' })).toEqual({
      token: 'token',
      repository: 'maelstrom-co/maelstrom',
      prNumber: '72',
      isFork: false,
    });
  });

  it('reads a different head repository as a fork', () => {
    expect(withEnv({ HEAD_REPOSITORY: 'attacker/maelstrom' }).isFork).toBe(
      true,
    );
  });

  it('reads an absent head repository as a fork', () => {
    // `head.repo.full_name` is null once the fork is deleted, and reaches the
    // action as an empty input. Unknown provenance must not open the bot
    // exemption, so it has to read as a fork rather than throw or default open.
    expect(withEnv({}).isFork).toBe(true);
  });

  it('reads an empty head repository as a fork', () => {
    expect(withEnv({ HEAD_REPOSITORY: '' }).isFork).toBe(true);
  });

  it('ignores case when comparing the head repository', () => {
    // GitHub owner and repository names are case-insensitive; a case-only
    // difference must not strip the exemption from this repo's own bot branches.
    expect(withEnv({ HEAD_REPOSITORY: 'Maelstrom-Co/Maelstrom' }).isFork).toBe(
      false,
    );
  });

  it('rejects a missing required variable', () => {
    expect(() => withEnv({ REPOSITORY: undefined })).toThrow(
      'REPOSITORY is required',
    );
  });
});

function withEnv(overrides: Record<string, string | undefined>) {
  const base: Record<string, string | undefined> = {
    GITHUB_TOKEN: 'token',
    REPOSITORY: 'maelstrom-co/maelstrom',
    PR_NUMBER: '72',
    HEAD_REPOSITORY: undefined,
  };
  const previous = { ...process.env };
  try {
    for (const [name, value] of Object.entries({ ...base, ...overrides })) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    return readConfig();
  } finally {
    process.env = previous;
  }
}
