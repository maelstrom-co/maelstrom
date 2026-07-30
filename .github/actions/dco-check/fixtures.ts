import type { CommitData } from './check-commits.ts';

export function commit(overrides: Partial<CommitData> = {}): CommitData {
  return {
    sha: '0123456789abcdef0123456789abcdef01234567',
    message: 'feat: add a thing',
    authorName: AUTHOR.name,
    authorEmail: AUTHOR.email,
    committerName: AUTHOR.name,
    committerEmail: AUTHOR.email,
    authorLogin: 'ada',
    authorType: 'User',
    parentCount: 1,
    ...overrides,
  };
}

const AUTHOR = { name: 'Ada Lovelace', email: 'ada@example.com' };
