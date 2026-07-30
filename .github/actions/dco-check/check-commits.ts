export interface CommitData {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  authorLogin: string | null;
  parentCount: number;
}

export type Verdict =
  | { commit: CommitData; state: 'signed' }
  | {
      commit: CommitData;
      state: 'exempt';
      reason: 'merge-commit' | 'bot-author';
    }
  | {
      commit: CommitData;
      state: 'violation';
      reason: 'missing-sign-off' | 'email-mismatch';
    };

export function checkCommits(commits: CommitData[]): Verdict[] {
  return commits.map((commit) => {
    // A merge has no authored content to certify, and a bot cannot make an
    // attestation at all — both checked before the trailer, so an exempt
    // commit is never reported as a violation.
    if (commit.parentCount > 1) {
      return { commit, state: 'exempt', reason: 'merge-commit' };
    }
    if (commit.authorLogin?.endsWith('[bot]')) {
      return { commit, state: 'exempt', reason: 'bot-author' };
    }

    const trailers = signOffTrailers(commit.message);
    if (trailers.length === 0) {
      return { commit, state: 'violation', reason: 'missing-sign-off' };
    }
    // A trailer with no `<…>` contributes no address, so it falls through to
    // `email-mismatch` — "you signed off, but as neither identity" is the
    // honest description of a malformed sign-off.
    const addresses = trailers.map(addressOf).filter(isPresent);

    // Author OR committer, either suffices. This is probot/dco's behaviour and
    // it is what keeps `.githooks/prepare-commit-msg` green: that hook (like
    // `git commit -s`) signs with the COMMITTER identity, so an author-only
    // rule would false-red every rebase, `--author=…`, or web-UI edit. Do not
    // "tighten" this to the author alone. Names are deliberately never
    // compared — `Trzesniewski` vs `Trześniewski` is a correct sign-off.
    const identities = [commit.authorEmail, commit.committerEmail].map(
      normalizeEmail,
    );
    if (addresses.some((address) => identities.includes(address))) {
      return { commit, state: 'signed' };
    }
    return { commit, state: 'violation', reason: 'email-mismatch' };
  });
}

export function signOffAddresses(message: string): string[] {
  return signOffTrailers(message).map(addressOf).filter(isPresent);
}

function signOffTrailers(message: string): string[] {
  return [...message.matchAll(SIGN_OFF_TRAILER)].map((match) => match[1] ?? '');
}

// Case-sensitive literal prefix anchored to line start: a trailer is a
// line-start construct, so `signed-off-by:` and an indented line are not
// trailers. The horizontal-whitespace class is deliberate — `\s*` would match
// the newline after a bare prefix and capture the next line as the value.
const SIGN_OFF_TRAILER = /^Signed-off-by:[ \t]*(.*)$/gm;

function addressOf(trailerValue: string): string | undefined {
  const close = trailerValue.lastIndexOf('>');
  if (close === -1) {
    return undefined;
  }
  const open = trailerValue.lastIndexOf('<', close);
  if (open === -1) {
    return undefined;
  }
  return normalizeEmail(trailerValue.slice(open + 1, close));
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined;
}

function normalizeEmail(email: string): string {
  // Plain case folding and nothing else: no `+`-alias stripping, no Gmail dot
  // folding. The attestation should be literal.
  return email.trim().toLowerCase();
}
