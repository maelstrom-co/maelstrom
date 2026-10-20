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

#### Using jujutsu

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
- [Vale](https://vale.sh/docs/vale-cli/installation/) 3.18.0 (documentation prose checks)

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
bun run docs:lint              # check documentation prose
```

Tests depend on built packages (`dependsOn: ["^build"]`), so build before
testing if you haven't already.

### Documentation prose checks

Run `bun run docs:lint` from the repository root after changing Markdown or
MDX documentation. The command downloads the pinned Vale style packages and
checks public documentation with the Microsoft technical-writing rules and the
project vocabulary. Install Vale from its release archive or a package manager
that provides version 3.18.0. CI fails on error-level findings across the
complete authored corpus, while local runs also report warnings. Run
`vale --version` to confirm it reports `3.18.0`.

For editor feedback, use a [Vale language server integration](https://docs.vale.sh/guides/lsp)
with the repository's Vale version and configuration. Editor settings are
optional; `bun run docs:lint` remains the portable source of truth.

Treat warnings as review prompts, not automatic rewrites. Before enabling a new
rule, sample its findings against Maelstrom's technical audience, resolve valid
findings, and document stable exceptions. Promote a rule to an error only after
the complete authored corpus is clean and authors have a clear fix.

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

### Generated documentation source links

TypeDoc source links use `DOCS_SOURCE_REF` when set, then the GitHub Actions
`GITHUB_SHA`, and otherwise fall back to `main`. Maintainers building outside
GitHub Actions should pin links to the exact build commit:

```bash
DOCS_SOURCE_REF="$(git rev-parse HEAD)" nx build docs
```

The selected value must be one URL-safe path segment; invalid values fail the
build. Both environment variables are Nx build inputs, so changing either one
invalidates the documentation build cache.

See the [README](./README.md) for the package architecture and core concepts.

## Pull requests

- Sign off every commit (`git commit -s`) — see [DCO](#developer-certificate-of-origin-dco).
- Run `nx run-many -t check test build typecheck` before pushing. CI runs the
  same four targets plus `e2e`.
- PR titles follow [Conventional Commits](https://www.conventionalcommits.org)
  (`type(scope): summary`). Squash-merge lands the PR title verbatim as the
  commit subject, so the title is the permanent changelog entry.
- To publish preview packages for a same-repository PR, add the `publish-preview`
  label. CI publishes public npm previews and comments install instructions on
  the PR. Versions use `0.0.0-pr.*` and a `pr-<number>` dist-tag. Installation
  requires no token. Fork PRs cannot publish packages through this workflow.
  Publishing stays disabled while the repository is private.

## Releasing

Releases are **cut locally and published by CI**. A maintainer versions, tags,
and pushes from their machine; pushing the `v*` tag triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds
and publishes every SDK package to **npm** (`registry.npmjs.org`). CI uses npm
trusted publishing through OIDC after package-level trust is configured.
The first publication needs the bootstrap credentials described below.

The workflow runs as **two jobs, and only the second one can publish**:

| Job | Permissions | Does |
| --- | --- | --- |
| `prepare` | `contents: read` | Checks tag ancestry, installs, builds, packs tarballs |
| `publish` | `contents: read`, `id-token: write` | Downloads tarballs, publishes, verifies |

`prepare` is where `bun install` runs dependency lifecycle scripts and the build
executes package code, so it holds no package write permission. `publish` holds
one, but `npm publish` is its only package-write operation. Artifact download
and registry verification are read-only. The publisher installs a pinned npm
CLI with lifecycle scripts disabled. It never installs project dependencies or
builds package code. Keep project installs and builds in `prepare`.

The tarball handoff accepts canonical POSIX USTAR files and directories under
one `package/` root. Paths use ASCII letters, digits, `.`, `_`, `@`, `+`, and `-`
within each segment. PAX and GNU extension records, links, path aliases, and
duplicate paths are rejected because archive parsers can interpret them
differently. Each tarball is limited to 50 MiB compressed and 128 MiB expanded.
The publisher validates the original bytes before any registry request.

Cutting a release needs `gh` authenticated (or `GITHUB_TOKEN` set) — the script
creates the GitHub release. Local package credentials are not needed because the
normal command uses `--skip-publish`.

### Release-boundary prerequisites (once per repository)

A `v*` tag push publishes public npm packages. Both publishing workflows block
publication while the source repository is private. Configure these settings
before the first npm release:

1. **Protected tags.** Settings → Rules → Rulesets, target `refs/tags/v*`,
   restrict creation to maintainers. Without this, anyone who can push a tag can
   start a release.

2. **`production` environment protection.** Settings → Environments →
   `production`: add required reviewers and, if you want a cancellation window,
   a wait timer. Naming the environment in the workflow buys nothing on its own
   — until this is configured, a tag push publishes with no human in the loop.
   The gate sits on the `publish` job, so approval is requested after the build
   and ancestry check have already passed.

3. **npm scope and bootstrap.** Confirm ownership of the npm `@maelstrom-co`
   organization and permission to publish every SDK package. Configure a
   short-lived granular token as the `production` environment secret
   `NPM_TOKEN`. It needs package write access and the npm permission required
   for unattended publishing. Enter the token directly in GitHub settings;
   never put it in source, terminal output, or a pull request. Keep this token
   only until every package has its first npm version and trusted publishers.

4. **Trusted publishers.** After the first publication, configure GitHub
   Actions trusted publishing for every package on npm. Set owner
   `maelstrom-co`, repository `maelstrom`, environment `production`, and
   workflow filename `release.yml`. Add a separate `publish-pr.yml` connection
   when the first preview is ready. Each new connection must complete a
   successful publish within two days, or it expires and must be recreated.
   Do not publish previews before the first complete release. Explicitly allow
   direct `npm publish`. Both publishing jobs use GitHub-hosted runners.
   Keep `repository.url` equal to
   `https://github.com/maelstrom-co/maelstrom.git`. Verify an OIDC publication,
   revoke the bootstrap token, and remove `NPM_TOKEN`.

Trusted publishing needs npm CLI 11.5.1 or later. The publisher pins its CLI
version in both workflows. Tag-triggered releases generate npm provenance.
PR previews and manual recovery disable automatic provenance because their
artifacts can come from a different commit than the workflow event. They still
use OIDC authentication and trusted publisher code. See
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

### npm dist-tag policy

Alpha installation uses the explicit `@alpha` tag. The release workflow publishes
prereleases under their preid and stable releases under `latest`. The registry
may also initialize `latest` on a package's first publication; inspect the actual
tags rather than assuming that the requested tag is the only tag changed.

Before enabling previews, finish and verify the first release for every package.
The preview publisher checks that every package already exists before publishing
any archive. Missing packages and failed lookups stop the entire preview.

During the pre-1.0 alpha period, a maintainer may promote a complete, verified
alpha release to `latest` so bare installs select an intentional version:

1. Verify all package versions and their `alpha` tags after the release succeeds.
2. Inspect each package's current `latest`. Never replace an existing stable
   release with an alpha, and never promote a `0.0.0-pr.*` preview.
3. With authorized npm account credentials, run
   `npm dist-tag add PACKAGE@VERSION latest --registry https://registry.npmjs.org`
   for each SDK package, replacing PACKAGE and VERSION with the verified values.
   This is a separate maintainer operation; trusted publication alone does not
   establish permission to edit dist-tags.
4. Verify `npm view PACKAGE dist-tags --json --registry https://registry.npmjs.org`
   for every package. Both `alpha` and `latest` must select the intended release.
   If promotion stops partway, finish the remaining packages and recheck all tags.
5. Test bare installs in a clean consumer before advertising them. Do not enable
   the production launch gate while tags or consumer checks remain incomplete.

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
   bun run scripts/release.ts --preid alpha --dry-run
   ```

   To rehearse the CI half too, run the **Release** workflow via
   `workflow_dispatch` with no tag and `dry_run` checked. It resolves, builds,
   and packs every package without publishing.

3. **Cut the release.** Drop `--dry-run` and add `--skip-publish`; pushing the
   tag hands off to CI:

   ```bash
   bun run scripts/release.ts --preid alpha --skip-publish
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
  to npm (`https://registry.npmjs.org`). Set it only to aim somewhere
  else, such as local Verdaccio (`nx local-registry`, `http://localhost:4873`) to
  rehearse the whole flow without touching the real registry.
- **`--dry-run` does not prove package access.** It validates manifests and
  tarballs but does not upload. After the manual repository launch, verify the
  first npm release and a same-repository PR preview before claiming publishing
  works. Packages and preview contents become public when published.
- **A new package needs npm trust.** The metadata assertion enforces the source
  repository, public access, and npm registry. Bootstrap new package names and
  configure their trusted publishers before relying on OIDC.
- **`--preid` tells Nx which prerelease identifier to use when calculating a
  bump.** The npm dist-tag always comes from the resolved version:
  `0.1.0-alpha.0` publishes under `alpha`, while a stable version publishes
  under `latest`. Pass `--preid alpha` while calculating alpha releases so
  `npm install @maelstrom-co/<pkg>` does not resolve to a prerelease.
- **`--version`** overrides the bump inferred from Conventional Commits. It
  accepts an explicit version (`0.1.0-alpha.0`) or a bump (`patch` | `minor` |
  `major` | `prerelease`).
- **`--skip-publish`** versions, tags, pushes, and creates the GitHub release
  without publishing from the local machine.
- The publish step rewrites `workspace:*` and `catalog:` specs to concrete
  versions before packing (npm doesn't do this from a package dir), so those
  protocols stay the source of truth in the repo.
