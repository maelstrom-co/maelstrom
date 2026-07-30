import type { CommitData } from './commit-data.ts';
import { normalizeEmail } from './sign-off/normalize-email.ts';
import { signOffAddresses } from './sign-off/sign-off-addresses.ts';
import type { Verdict } from './verdict.ts';

export function checkCommits(
  commits: CommitData[],
  isFork: boolean,
): Verdict[] {
  return commits.map((commit) => {
    // Checked before the trailer, so an exempt commit is never reported as a
    // violation. The premise is not that a merge carries nothing to certify —
    // one that resolves a conflict carries changes present in neither parent —
    // but that telling those apart would mean diffing pull-request content this
    // workflow deliberately never checks out. An accepted gap, recorded in
    // CONTRIBUTING.md beside the squash caveat it resembles.
    if (commit.parentCount > 1) {
      return { commit, state: 'exempt', reason: 'merge-commit' };
    }
    // `authorType` is not proof of anything on its own. GitHub resolves the
    // whole author account from the commit's email alone, so `Bot` is a
    // property of whichever account that lookup landed on — a contributor who
    // sets `user.email` to a bot's noreply address arrives here typed `Bot`,
    // exactly as they would arrive carrying its `[bot]` login. The branch is
    // what carries the trust: a commit on a base-repo branch had to be pushed
    // by someone who already has write access, while a fork is precisely the
    // untrusted population this gate exists for. Unknown provenance reads as a
    // fork, so the exemption stays shut.
    if (commit.authorType === 'Bot' && !isFork) {
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
