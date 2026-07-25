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
- Node.js 22 (matches CI)

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
nx dev demo                    # run the demo app (see apps/demo/README.md for voice/provider setup)
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

Releases are **manual and local** for now — a maintainer who is a member of the
`@maelstrom-co` npm org runs them from their own machine. There is no CI release
automation. Real releases publish to **public npm** (`registry.npmjs.org`);
per-PR previews are a separate flow that targets GitHub Packages.

### One-time setup

Authenticate to public npm (you must be in the `@maelstrom-co` org with publish
rights):

```bash
npm login --registry=https://registry.npmjs.org
```

The release script also creates a GitHub release, so `gh` must be authenticated
(or `GITHUB_TOKEN` set).

### Release steps

`scripts/release.ts` runs the entire release in one command — version (fixed,
shared across all packages), changelog, commit (`chore(release): {version}`),
tag, push, GitHub release, and npm publish.

1. Sync `main`, ensure a clean working tree, and install: `bun install`.

2. **Dry-run first.** `--dry-run` makes no commits, tags, or publishes — it only
   reports what would happen:

   ```bash
   bun run scripts/release.ts --version 0.1.0-alpha.0 --preid alpha --dry-run
   ```

3. **Release** (drop `--dry-run`):

   ```bash
   bun run scripts/release.ts --version 0.1.0-alpha.0 --preid alpha
   ```

   For the very first release (no prior `v*` tag exists yet), add
   `--first-release`.

### Flags and gotchas

- **Git state is pushed before the npm publish.** `scripts/release.ts` runs
  version → changelog → commit → tag → push → GitHub release **before** it
  publishes to npm. If the publish fails midway, the commit, tag, and GitHub
  release already exist on the remote while npm has no matching version —
  recovery is manual: fix the cause and re-publish that same version (do **not**
  re-run the full release, which would bump the version again). Always
  `--dry-run` first to reduce the risk.
- **`RELEASE_REGISTRY` is an override, not a requirement.** Publishing defaults
  to public npm (`https://registry.npmjs.org`). Set it only to aim somewhere
  else — a local Verdaccio (`nx local-registry`, `http://localhost:4873`) to
  rehearse the whole flow without touching the real registry.
- **npm provenance is off.** `--provenance` requires publishing from GitHub
  Actions with `id-token: write`; releases are still manual and local, so there
  is no trusted build to attest to. It gets enabled with CI publishing.
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
