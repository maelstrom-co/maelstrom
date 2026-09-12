# GitHub squash-merge author attribution

## Finding

There is an exact public report of this identity mismatch in native GitHub
stacked-PR squash merges. [github/gh-stack #371](https://github.com/github/gh-stack/issues/371)
was opened on July 30, 2026 and remains open as of September 12, 2026.

The report states that the generated commit combines the PR author's name with
the stack merger's email. The original commits have the correct identity.
An [independent reproduction](https://github.com/github/gh-stack/issues/371#issuecomment-5187609870)
on August 5 identifies the GitHub web UI's **Squash and merge stack** action.
The stack was maintained with `gh stack`, but the merge happened in the web UI.

An [earlier discussion](https://github.com/github/gh-stack/discussions/272)
from July 22 reports the same mismatch and contrasts it with correct attribution
on ordinary, non-stacked PRs. A
[follow-up reproduction](https://github.com/github/gh-stack/discussions/272#discussioncomment-17756645)
reports that merging only the bottom PR of a stack can also trigger the defect.

The Maelstrom commits match the reported symptom. Their native stack membership
and exact merge path have not been confirmed, so the specific cause remains
probable rather than established. No verified fix was found in these sources.

## Repository evidence

Checked on 2026-09-12 against the GitHub REST API and local commit objects.

Three pull requests contained commits by `Nacho Vazquez <nacho@naxo.dev>`.
Their resulting squash commits record `Nacho Vazquez <xppcoder@gmail.com>`.
GitHub links the latter email to `Jacarte`, who merged all three pull requests.

| Pull request | Original commit | Squash commit |
| --- | --- | --- |
| [#169](https://github.com/maelstrom-co/maelstrom/pull/169) | [5cb9151](https://github.com/maelstrom-co/maelstrom/commit/5cb91513d8a8e21d17f7406f0d0c594a45f98d13) | [bd29917](https://github.com/maelstrom-co/maelstrom/commit/bd29917d32a6bed291d28c20c0e5abee3a2a65e2) |
| [#124](https://github.com/maelstrom-co/maelstrom/pull/124) | [870f016](https://github.com/maelstrom-co/maelstrom/commit/870f016873d35e48caf5e5900c0689640d3823d1) | [21e9f07](https://github.com/maelstrom-co/maelstrom/commit/21e9f07ceaf98b3326eedf559a08c5c72d265914) |
| [#121](https://github.com/maelstrom-co/maelstrom/pull/121) | [d2b65a0](https://github.com/maelstrom-co/maelstrom/commit/d2b65a0d513b0ad718f8e9ae6acbacff378505e9) | [135ced1](https://github.com/maelstrom-co/maelstrom/commit/135ced15cfaa7391a3cb6570620ba261f1a0221b) |

The mismatch appeared when the squash commits were created. These records do
not identify whether the merger used the GitHub UI, CLI, or another integration.
The [merge event for #169](https://api.github.com/repos/maelstrom-co/maelstrom/issues/169/events)
has no `performed_via_github_app` value, so it does not identify the merge client.

The changelog renderer previously grouped contributors by name and resolved
their emails to GitHub handles. This mixed commit metadata caused it to append
`@Jacarte` to `Nacho Vazquez`.

The renderer checks commit attribution and omits a handle when the same display
name resolves to conflicting accounts. The correction table in
`scripts/lib/release-author-overrides.ts` restores Nacho's identity for the three
documented squash commits before grouping authors. Each correction requires the
exact commit hash and the expected original name and email. Javier's author and
co-author entries keep their existing identities.

These overrides affect release notes only. They do not rewrite commit history
or change GitHub's attribution of the original commits.

## Merge controls and limits

[GitHub's merge documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/merging-a-pull-request)
says the squash-merge email selector appears only when the merger is the PR
author and has multiple account emails. The mismatch does not establish that
Javier deliberately selected his email for Nacho's commits.

The [CLI manual](https://cli.github.com/manual/gh_pr_merge) documents
`--author-email`. The CLI
[merge command](https://github.com/cli/cli/blob/trunk/pkg/cmd/pr/merge/merge.go)
defaults that option to an empty string. Its
[API implementation](https://github.com/cli/cli/blob/trunk/pkg/cmd/pr/merge/http.go)
sets GraphQL `AuthorEmail` only when an explicit nonempty value is supplied.
It does not construct the squash commit locally using Git identity settings.

The request to default to local `git user.email`,
[cli/cli #8590](https://github.com/cli/cli/issues/8590), remains open. A
[maintainer comment](https://github.com/cli/cli/issues/8590#issuecomment-1956653544)
explains why an earlier implementation was declined.

`--author-email` is not a verified workaround for the stacked-PR defect.
[cli/cli #8000](https://github.com/cli/cli/issues/8000) separately reports a merge
queue ignoring that field. The issue was closed after the reporter confirmed
that the CLI transmitted the requested value. That closure does not establish
that GitHub fixed the platform behavior.

[GitHub's attribution documentation](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/troubleshooting-commits/why-are-my-commits-linked-to-the-wrong-user)
confirms that account attribution depends on the email in the commit header.
Correct local identity settings cannot repair metadata in an existing squash
commit.
