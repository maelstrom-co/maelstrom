export interface CommitData {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  authorLogin: string | null;
  authorType: string | null;
  parentCount: number;
}

export type Verdict =
  | { commit: CommitData; state: 'signed' }
  | {
      commit: CommitData;
      state: 'exempt';
      reason: 'merge-commit' | 'bot-author';
    }
  | { commit: CommitData; state: 'violation'; reason: 'missing-sign-off' }
  | {
      commit: CommitData;
      state: 'violation';
      reason: 'email-mismatch';
      signedOffAs: string[];
    };

export type Violation = Extract<Verdict, { state: 'violation' }>;

export function checkCommits(commits: CommitData[]): Verdict[] {
  return commits.map((commit) => {
    // A merge has no authored content to certify, and a bot cannot make an
    // attestation at all — both checked before the trailer, so an exempt
    // commit is never reported as a violation.
    if (commit.parentCount > 1) {
      return { commit, state: 'exempt', reason: 'merge-commit' };
    }
    // Trust boundary: GitHub's own account classification is the only thing
    // that opens this exemption. The `[bot]` login suffix must not — that login
    // is resolved from the commit's email, so anyone who sets `user.email` to a
    // bot's noreply address would exempt themselves from the gate.
    if (commit.authorType === 'Bot') {
      return { commit, state: 'exempt', reason: 'bot-author' };
    }

    const trailers = signOffTrailers(commit.message);
    if (trailers.length === 0) {
      return { commit, state: 'violation', reason: 'missing-sign-off' };
    }
    // A trailer with no `<…>` contributes no address, so it falls through to
    // `email-mismatch` — "you signed off, but as neither identity" is the
    // honest description of a malformed sign-off.
    const addresses = trailers.flatMap((trailer) => addressOf(trailer) ?? []);

    // Author OR committer email, either suffices: that matching rule is
    // probot/dco's, and it is what keeps `.githooks/prepare-commit-msg` green
    // — that hook (like `git commit -s`) signs with the COMMITTER identity, so
    // an author-only rule would false-red every rebase, `--author=…`, or web-UI
    // edit. Do not "tighten" this to the author alone. Names are deliberately
    // never compared — `Trzesniewski` vs `Trześniewski` is a correct sign-off.
    // Blank identities are dropped: a commit authored with no email must not be
    // certifiable by an equally empty `<>` sign-off.
    const identities = [commit.authorEmail, commit.committerEmail]
      .map(normalizeEmail)
      .filter((email) => email !== '');
    if (addresses.some((address) => identities.includes(address))) {
      return { commit, state: 'signed' };
    }
    return {
      commit,
      state: 'violation',
      reason: 'email-mismatch',
      signedOffAs: addresses,
    };
  });
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
  const address = normalizeEmail(
    SIGN_OFF_ADDRESS.exec(trailerValue)?.[1] ?? '',
  );
  // An empty address is rejected here, at the parse boundary: left to stand it
  // would match a commit whose author and committer emails are themselves
  // empty, certifying a commit nobody signed.
  return address === '' ? undefined : address;
}

// The final `<…>` pair on the line, with anything after it (a CRLF `\r`, say)
// tolerated.
const SIGN_OFF_ADDRESS = /<([^<>]*)>[^>]*$/;

function normalizeEmail(email: string): string {
  // Trim and case-fold, nothing more: no `+`-alias stripping, no Gmail dot
  // folding. The attestation should be literal.
  return email.trim().toLowerCase();
}
