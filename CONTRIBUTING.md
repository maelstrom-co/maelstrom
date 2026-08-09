# Contributing to Maelstrom

Thanks for your interest in contributing! Bug reports, feature requests,
documentation fixes, and code contributions are all welcome.

Please note this project follows our [Code of Conduct](./CODE_OF_CONDUCT.md).

Found a bug or have feedback on a preview release? Open a
[GitHub Issue](../../issues) using the provided templates — they apply the
right triage label (`bug` or `preview-feedback`) automatically.

## License of contributions

Maelstrom is released under the [MIT License](./LICENSE). By submitting a
contribution, you agree it is licensed under MIT (inbound = outbound): you keep
copyright to your work and grant the project and its users an MIT license to it.
No CLA or copyright assignment is required.

## Developer Certificate of Origin (DCO)

Every commit must be **signed off** under the
[Developer Certificate of Origin](https://developercertificate.org/), certifying
you have the right to submit it under the project's license:

```bash
git commit -s -m "feat: ..."   # appends a "Signed-off-by" trailer
```

Use your real name and a reachable email. PRs whose commits aren't signed off
will be asked to amend before merge.

<details>
<summary>Developer Certificate of Origin 1.1 (full text)</summary>

```
By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I have the right
    to submit it under the open source license indicated in the file; or

(b) The contribution is based upon previous work that, to the best of my
    knowledge, is covered under an appropriate open source license and I have
    the right under that license to submit that work with modifications,
    whether created in whole or in part by me, under the same open source
    license (unless I am permitted to submit under a different license), as
    indicated in the file; or

(c) The contribution was provided directly to me by some other person who
    certified (a), (b) or (c) and I have not modified it.

(d) I understand and agree that this project and the contribution are public and
    that a record of the contribution (including all personal information I
    submit with it, including my sign-off) is maintained indefinitely and may
    be redistributed consistent with this project or the open source license(s)
    involved.
```

</details>

### Automatic sign-off (optional)

Rather than remembering `-s` on every commit, enable the bundled hook once per
clone:

```bash
git config core.hooksPath .githooks
```

It appends your `Signed-off-by` trailer automatically and does nothing if the
trailer is already present. See [`.githooks/README.md`](./.githooks/README.md)
for details. Requires Git 2.15+.

The hook is a `prepare-commit-msg` hook, so it only fires in tools that run that
hook on commit — plain `git commit`, Graphite, GitKraken, GitHub Desktop, and
VS Code all do. Some tools don't (see below).

#### Using jujutsu?

jj never runs git hooks, so the hook above does nothing for `jj` commits. Instead,
enable jj's built-in sign-off trailer once per repo (jj ≥ 0.24):

```bash
jj config set --repo templates.commit_trailers 'format_signed_off_by_trailer(self)'
```

Using another tool that skips `prepare-commit-msg` (JetBrains IDEs, lazygit,
Sourcetree)? See
[`.githooks/SIGN-OFF-TOOLS.md`](./.githooks/SIGN-OFF-TOOLS.md) for each tool's
native sign-off option, or just fall back to `git commit -s`.

### Enforcement

The `dco` check runs on every pull request and is a required check on `main`. If
any commit is missing its sign-off, the check goes red and a bot comment lists
the offending commits with a reason for each.

To fix it, re-sign the branch and force-push, rebasing onto the pull request's
actual base branch — not just any local ref named `main`:

**Working from a fork:**

```bash
git remote add upstream https://github.com/maelstrom-co/maelstrom.git  # once, if not set
git fetch upstream
git rebase --signoff upstream/main   # re-sign every commit on the branch
git push --force-with-lease          # rewriting history requires a force push
```

**Working from a branch in this repository:**

```bash
git fetch origin
git rebase --signoff origin/main     # re-sign every commit on the branch
git push --force-with-lease          # rewriting history requires a force push
```

Single commit, either case: `git commit --amend --signoff --no-edit`.

**What the check compares.** The `Signed-off-by` email must equal either the
commit's **author** email or its **committer** email, compared
case-insensitively. The **name is never compared**, so an ASCII-folded name (or
one missing diacritics) is fine. Merge commits are exempt, as are commits from a
bot account — but the bot exemption applies **only on branches in this
repository**, never on a fork. GitHub resolves a commit's author account from
the email in the commit header alone, so on a fork that classification is
whatever the contributor put in `user.email`; a base-repo branch is one only a
contributor with write access can push to. A pull request from a fork therefore
needs a sign-off on every commit, whatever account its commits appear to be
from.

Either identity counts because `git commit -s` and the bundled hook both sign
with your **committer** identity — so re-signing or rebasing *someone else's*
commits still satisfies the check: you are certifying as the committer.

The attestation lives in the pull request's commit history, which is what the
check audits; GitHub's web-UI squash can drop the trailer from the resulting
`main` commit. That gap is accepted — probot/dco has it too.

**The merge exemption is unconditional, and that is an accepted gap too.** A
merge commit usually certifies nothing of its own, but conflict resolutions and
edits staged before the merge is committed live in the merge commit's own tree,
present in neither parent — so unsigned changes can reach a pull request inside
an unsigned merge commit. Telling that apart from an ordinary merge means
diffing the pull request's content, and the `dco` workflow runs on
`pull_request_target` and deliberately never checks out or executes any
pull-request code. What still catches it: those changes appear in the pull
request diff under a conspicuous `Merge branch …` commit, and the check's
sticky comment always discloses how many commits it exempted and why. probot/dco
and dcoapp/app both exempt merges unconditionally as well. Prefer rebasing onto
the base branch (`upstream/main` on a fork, `origin/main` in this repository —
see above) over `git merge main` on a branch, and the case does not arise.

## Prerequisites

- [Bun](https://bun.sh) (package manager — the repo is a Bun workspace)
- Node.js 24 (matches `.nvmrc` and CI)

## Getting started

1. Fork and clone the repository.
2. Add the parent repository as the `upstream` remote — `git rebase`, further
   down in [DCO](#developer-certificate-of-origin-dco), rebases onto it:

   ```bash
   git remote add upstream https://github.com/maelstrom-co/maelstrom.git
   ```

3. Install dependencies: `bun install`.
4. Create a branch for your change.
5. Make your change with tests, then open a pull request.

> The `@maelstrom-co/*` packages resolve as local workspace packages
> (`workspace:*`), so `bun install` works out of the box on a fresh clone —
> no `GITHUB_TOKEN` or other authentication is required.

## Development

```bash
bun install                    # install dependencies
bunx nx dev demo               # run the demo app (see apps/demo/README.md for environment and optional voice setup)
nx run-many -t build           # build all packages
nx run-many -t test            # run all tests
nx run-many -t typecheck       # type-check all packages
```

Tests depend on built packages (`dependsOn: ["^build"]`), so build before
testing if you haven't already.

### Public API documentation audits

Build the packages before auditing declarations or packed consumers, and build
the documentation site before auditing generated TypeDoc pages:

```bash
nx run-many -t build
nx build docs
```

Run the declaration and clean packed-consumer checks, the generated TypeDoc
check, and the `stripInternal` comparison from the repository root:

```bash
bun run audit:public-api-docs --declarations --packed-consumer
bun run audit:public-api-docs --typedoc
bun run audit:strip-internal
```

The public API audit prints JSON and succeeds only when both `errors` and
`findings` are empty. The `stripInternal` comparison prints one result per
public package; `identical` and `not-applicable` are acceptable. A
`drift-rejected` result reports declaration drift but deliberately exits zero,
so verification scripts and CI consumers must parse the JSON and treat that
status as a rejection.

See the [README](./README.md) for the package architecture and core concepts.

## Pull requests

- Sign off every commit (`git commit -s`) — see [DCO](#developer-certificate-of-origin-dco).
- Run `nx run-many -t build test typecheck` before pushing.
- PR titles follow [Conventional Commits](https://www.conventionalcommits.org)
  (`type(scope): summary`). Squash-merge lands the PR title verbatim as the
  commit subject, so the title is the permanent changelog entry.
- To publish preview packages for a PR, add the `publish-preview` label. CI
  publishes versioned previews to GitHub Packages and comments install
  instructions on the PR. Preview versions use `0.0.0-pr.*` and a `pr-<number>`
  dist-tag. Installing any package requires a classic `read:packages` PAT from a
  GitHub user with repository access.

## Releasing

Releases are **cut locally and published by CI**. A maintainer versions, tags,
and pushes from their machine; pushing the `v*` tag triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds
and publishes every package to **GitHub Packages** (`npm.pkg.github.com`). CI
authenticates with the repository's short-lived `GITHUB_TOKEN`; no package
secret is stored.

The workflow runs as **two jobs, and only the second one can publish**:

| Job | Permissions | Does |
| --- | --- | --- |
| `prepare` | `contents: read` | Checks tag ancestry, installs, builds, packs tarballs |
| `publish` | `contents: read`, `packages: write` | Downloads tarballs, publishes, verifies |

`prepare` is where `bun install` runs dependency lifecycle scripts and the build
executes package code, so it holds no package write permission. `publish` holds
one, but `npm publish` is its only package-write operation. Artifact download
and registry verification are read-only. The job runs no install, build, or
dependency or package code. Keep it that way. Adding an install step to
`publish` hands package write access back to the dependency tree and undoes the
split.

Cutting a release needs `gh` authenticated (or `GITHUB_TOKEN` set) — the script
creates the GitHub release. Local package credentials are not needed because the
normal command uses `--skip-publish`.

### Release-boundary prerequisites (once per repository)

A `v*` tag push publishes to GitHub Packages. Everything that decides *who can cause
that* lives in repository settings, not in this repo — configure all of it
**before the first release**:

1. **Protected tags.** Settings → Rules → Rulesets, target `refs/tags/v*`,
   restrict creation to maintainers. Without this, anyone who can push a tag can
   start a release.

2. **`production` environment protection.** Settings → Environments →
   `production`: add required reviewers and, if you want a cancellation window,
   a wait timer. Naming the environment in the workflow buys nothing on its own
   — until this is configured, a tag push publishes with no human in the loop.
   The gate sits on the `publish` job, so approval is requested after the build
   and ancestry check have already passed.

3. **Package access.** For every package under the organization, open **Package
   settings** and confirm the source repository is `maelstrom-co/maelstrom`.
   Enable **Inherit access from repository**. Keep package visibility private.
   Existing package records need this manual check because repository metadata
   cannot change a package setting after publication.

4. **Workflow access.** Repository-linked packages normally grant their source
   repository Actions access. If publishing returns `permission_denied`, add
   `maelstrom-co/maelstrom` under **Manage Actions access** with write access.

The workflow enforces one boundary on its own, independent of the settings
above: `prepare` refuses to continue unless the tagged commit is reachable from
`main`, so a tag pointing at an unmerged tree fails before anything is built.
That check is a backstop, not a replacement for protected tags — it constrains
*what* can be released, while the ruleset constrains *who* can release.

### Release steps

`scripts/release.ts --skip-publish` runs the local half — version (fixed, shared
across all packages), changelog, commit (`chore(release): {version}`), tag, push,
and GitHub release. CI does the publish.

1. Sync `main`, ensure a clean working tree, and install: `bun install`.

2. **Rehearse.** `--dry-run` makes no commits, tags, or publishes:

   ```bash
   bun run scripts/release.ts --version 0.1.0-alpha.0 --preid alpha --dry-run
   ```

   To rehearse the CI half too, run the **Release** workflow via
   `workflow_dispatch` with no tag and `dry_run` checked. It resolves, builds,
   and packs every package without publishing.

3. **Cut the release.** Drop `--dry-run` and add `--skip-publish`; pushing the
   tag hands off to CI:

   ```bash
   bun run scripts/release.ts --version 0.1.0-alpha.0 --preid alpha --skip-publish
   ```

   For the very first release (no prior `v*` tag exists yet), add
   `--first-release`.

4. Watch the **Release** workflow. It refuses to publish if any package manifest
   disagrees with the tag, and verifies every package is live on the registry
   before going green.

### Recovering a partial release

If the publish fails partway, **re-run the workflow** — do not re-cut. The
publish step passes `--skip-published`, so packages that already landed are
skipped and only the missing ones go out. npm versions are immutable, so
re-publishing one that succeeded is a hard error; that flag is what makes the
re-run work.

### Flags and gotchas

- **Git state is pushed before the package publish**, and now by a different
  actor: the tag, commit, and GitHub release exist the moment you push, while the
  package publish completes seconds later in CI. A failed publish leaves that gap — close it by
  re-running the workflow (see "Recovering a partial release"), never by
  re-cutting, which would bump the version again.
- **`RELEASE_REGISTRY` is an override, not a requirement.** Publishing defaults
  to GitHub Packages (`https://npm.pkg.github.com`). Set it only to aim somewhere
  else, such as local Verdaccio (`nx local-registry`, `http://localhost:4873`) to
  rehearse the whole flow without touching the real registry.
- **`--dry-run` does not prove package access.** It validates manifests and
  tarballs but does not upload. Use a labeled PR preview to test real GitHub
  Packages authentication before the first tagged release.
- **A new package links to this repository through `repository.url`.** The
  metadata assertion enforces that URL and the GitHub registry. Confirm inherited
  access in package settings after the first preview publishes it.
- **`--preid` sets both the prerelease identifier and the npm dist-tag.** While
  in prerelease, pass `--preid alpha` so the release publishes under the `alpha`
  dist-tag and `npm install @maelstrom-co/<pkg>` does not resolve to a
  prerelease. Omit `--preid` (dist-tag defaults to `latest`) only for the first
  stable release.
- **`--version`** accepts an explicit version (`0.1.0-alpha.0`) or a bump
  (`patch` | `minor` | `major` | `prerelease`).
- **`--skip-publish`** versions, tags, pushes, and creates the GitHub release
  without publishing from the local machine.
- The publish step rewrites `workspace:*` and `catalog:` specs to concrete
  versions before packing (npm doesn't do this from a package dir), so those
  protocols stay the source of truth in the repo.
