import type { CommitData } from './check-commits.ts';

export class CommitPayloadError extends Error {
  constructor(problem: string, sha?: string) {
    super(
      sha === undefined
        ? `malformed commit payload: ${problem}`
        : `malformed commit payload for ${sha}: ${problem}`,
    );
    this.name = 'CommitPayloadError';
  }
}

export function toCommitData(payload: unknown): CommitData {
  const entry = asRecord(payload, 'the commit entry');
  const sha = asString(entry.sha, 'sha');
  const commit = asRecord(entry.commit, 'commit', sha);
  const account = asNullableRecord(entry.author, 'author', sha);
  const author = asNullableRecord(commit.author, 'commit.author', sha);
  const committer = asNullableRecord(commit.committer, 'commit.committer', sha);
  if (!Array.isArray(entry.parents)) {
    throw new CommitPayloadError('parents is not an array', sha);
  }
  return {
    sha,
    message: asString(commit.message, 'commit.message', sha),
    // An absent identity becomes `''`, the value the policy refuses to let an
    // equally empty `<>` sign-off certify. A present but non-string one is a
    // malformed payload, not an empty identity.
    authorName: asOptionalString(author?.name, 'commit.author.name', sha) ?? '',
    authorEmail:
      asOptionalString(author?.email, 'commit.author.email', sha) ?? '',
    committerName:
      asOptionalString(committer?.name, 'commit.committer.name', sha) ?? '',
    committerEmail:
      asOptionalString(committer?.email, 'commit.committer.email', sha) ?? '',
    authorLogin: asOptionalString(account?.login, 'author.login', sha) ?? null,
    authorType: asOptionalString(account?.type, 'author.type', sha) ?? null,
    parentCount: entry.parents.length,
  };
}

function asRecord(
  value: unknown,
  field: string,
  sha?: string,
): Record<string, unknown> {
  const record = asNullableRecord(value, field, sha);
  if (record === undefined) {
    throw new CommitPayloadError(`${field} is not an object`, sha);
  }
  return record;
}

function asNullableRecord(
  value: unknown,
  field: string,
  sha?: string,
): Record<string, unknown> | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new CommitPayloadError(`${field} is not an object`, sha);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string, sha?: string): string {
  const text = asOptionalString(value, field, sha);
  if (text === undefined) {
    throw new CommitPayloadError(`${field} is not a string`, sha);
  }
  return text;
}

function asOptionalString(
  value: unknown,
  field: string,
  sha?: string,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new CommitPayloadError(`${field} is not a string`, sha);
  }
  return value;
}
