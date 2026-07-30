import type { CommitData } from './commit-data.ts';
import { normalizeEmail } from './sign-off/normalize-email.ts';
import { signOffAddresses } from './sign-off/sign-off-addresses.ts';
import type { Verdict } from './verdict.ts';

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

    const { trailerCount, addresses } = signOffAddresses(commit.message);
    if (trailerCount === 0) {
      return { commit, state: 'violation', reason: 'missing-sign-off' };
    }

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
    // A trailer with no `<…>` contributes no address, so it falls through to
    // `email-mismatch` — "you signed off, but as neither identity" is the
    // honest description of a malformed sign-off.
    return {
      commit,
      state: 'violation',
      reason: 'email-mismatch',
      signedOffAs: addresses,
    };
  });
}
