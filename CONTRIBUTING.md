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

## Prerequisites

- [Bun](https://bun.sh) (package manager — the repo is a Bun workspace)
- Node.js 24 (matches `.nvmrc` and CI)

## Getting started

1. Fork and clone the repository.
2. Install dependencies: `bun install`.
3. Create a branch for your change.
4. Make your change with tests, then open a pull request.

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

See the [README](./README.md) for the package architecture and core concepts.

## Pull requests

- Sign off every commit (`git commit -s`) — see [DCO](#developer-certificate-of-origin-dco).
- Run `nx run-many -t build test typecheck` before pushing.
- PR titles follow [Conventional Commits](https://www.conventionalcommits.org)
  (`type(scope): summary`). Squash-merge lands the PR title verbatim as the
  commit subject, so the title is the permanent changelog entry.
- To publish preview packages for a PR, add the `publish-preview` label. CI
  publishes versioned previews to GitHub Packages and comments install
  instructions on the PR. This is separate from a real release (below):
  previews deliberately stay off public npm, because an npm publish is
  permanent once the 72-hour unpublish window closes and `0.0.0-pr.*` versions
  would accumulate on the public registry forever. Installing a preview needs a
  `read:packages` PAT; installing a release needs nothing.

## Releasing

Releases are **cut locally and published by CI**. A maintainer versions, tags,
and pushes from their machine; pushing the `v*` tag triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds
and publishes every package to **public npm** (`registry.npmjs.org`). Apart from
the one-time bootstrap below, nobody publishes from a laptop — a provenance
attestation is only meaningful when the build it describes ran somewhere
auditable.

Per-PR previews are a separate flow that targets GitHub Packages.

CI authenticates to npm with **OIDC trusted publishing** — no token is stored
anywhere. There is no `NPM_TOKEN` secret, and there should never be one: npm
caps granular write tokens at 90 days, so a stored token means rotating a secret
every quarter and a broken release the one time it's forgotten.

The workflow runs as **two jobs, and only the second one can publish**:

| Job | Permissions | Does |
| --- | --- | --- |
| `prepare` | `contents: read` | Checks tag ancestry, installs, builds, packs tarballs |
| `publish` | `id-token: write` | Downloads tarballs, `npm publish`, verifies |

`prepare` is where `bun install` runs dependency lifecycle scripts and the build
executes package code — so it holds no npm identity to steal. `publish` holds
one, and runs nothing but `npm publish` against tarballs `prepare` already
produced: no install, no build, no third-party code. Keep it that way. Adding an
install step to `publish` hands the OIDC token back to the dependency tree and
undoes the split.

Cutting a release needs `gh` authenticated (or `GITHUB_TOKEN` set) — the script
creates the GitHub release. No npm credentials are needed locally after the
bootstrap below.

### Bootstrap (once per package, already done for existing packages)

Trusted publishing cannot be configured for a package that does not exist yet —
npm only exposes the setting on a published package. So each **new** package
needs one manual publish before CI can take it over:

1. Log in to npm as a member of the `@maelstrom-co` org with publish rights.
   Sessions are short-lived, so do this immediately before publishing:

   ```bash
   npm login --registry=https://registry.npmjs.org
   ```

2. Publish the first version with the release script, not bare `npm publish` —
   the script rewrites `workspace:*` and `catalog:` specs to concrete versions,
   which npm will not do for you:

   ```bash
   bun scripts/publish-packages.ts --tag alpha --skip-published
   ```

3. On npmjs.org, open each package → **Settings → Trusted publishing**, and add
   a GitHub Actions publisher pointing at this repository and `release.yml`.
   The publisher's **environment** field must either be left empty or say
   `production`, because that is the environment `release.yml` declares — a
   mismatch here is rejected at publish time, and the error does not say which
   side is wrong.

4. Log out locally. Nothing else should ever publish from a laptop.

This first version ships **without provenance** — attestation requires a build
CI can vouch for. Every release after it is CI-published and attested.

### Release-boundary prerequisites (once per repository)

A `v*` tag push publishes to public npm. Everything that decides *who can cause
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

3. **npm trusted publisher.** Each package's publisher must point at this
   repository, `release.yml`, and the `production` environment. A mismatch is
   rejected at publish time with an error that does not say which side is wrong.
   See the bootstrap section above.

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

- **Git state is pushed before the npm publish**, and now by a different actor:
  the tag, commit, and GitHub release exist the moment you push, while npm
  publishes seconds later in CI. A failed publish leaves that gap — close it by
  re-running the workflow (see "Recovering a partial release"), never by
  re-cutting, which would bump the version again.
- **`RELEASE_REGISTRY` is an override, not a requirement.** Publishing defaults
  to public npm (`https://registry.npmjs.org`). Set it only to aim somewhere
  else — a local Verdaccio (`nx local-registry`, `http://localhost:4873`) to
  rehearse the whole flow without touching the real registry.
- **Provenance turns itself on when the repo goes public.** npm refuses to
  attest a build it cannot link to public source, so the release job passes
  `--provenance` only when the repository is public and warns when it does not.
  Nothing to change on the day it flips.
- **`--dry-run` does not exercise provenance.** npm skips attestation entirely
  under `--dry-run`, so a green rehearsal says nothing about whether provenance
  works. The first real publish is the first real test. This matters more now
  that `publish` uploads a pre-packed tarball rather than packing in place:
  attestation is generated by the job that uploads, and that path has not been
  exercised against the real registry yet. Watch the first public release.
- **A new package will fail its first CI release.** It has no trusted publisher
  yet, and it cannot have one until it exists on the registry. Run the bootstrap
  above for it before adding it to a release.
- **Never add an `NPM_TOKEN` secret to work around an auth failure.** A token in
  `.npmrc` can stop npm from attempting the OIDC exchange at all, so it turns a
  fixable misconfiguration into a permanent one — and reintroduces the 90-day
  rotation. Fix the trusted publisher instead.
- **`--preid` sets both the prerelease identifier and the npm dist-tag.** While
  in prerelease, pass `--preid alpha` so the release publishes under the `alpha`
  dist-tag and `npm install @maelstrom-co/<pkg>` does not resolve to a
  prerelease. Omit `--preid` (dist-tag defaults to `latest`) only for the first
  stable release.
- **`--version`** accepts an explicit version (`0.1.0-alpha.0`) or a bump
  (`patch` | `minor` | `major` | `prerelease`).
- **`--skip-publish`** versions, tags, pushes, and creates the GitHub release
  without publishing to npm.
- The publish step rewrites `workspace:*` and `catalog:` specs to concrete
  versions before packing (npm doesn't do this from a package dir), so those
  protocols stay the source of truth in the repo.
