# Public launch guide

Use this checklist to prepare the first public release. The repository owner
changes visibility manually after reviewing history and approving the preparation
pull request. Keep the repository private during preparation.

## Prepare accounts and protections

- Confirm ownership of the npm `@maelstrom-co` scope and permission to create
  and publish every SDK package. Follow the
  [release prerequisites](../CONTRIBUTING.md#release-boundary-prerequisites-once-per-repository)
  for bootstrap credentials and trusted publishers.
- Require pull requests to `main`, at least one approval, and CODEOWNERS review
  for owned paths. Require the emitted checks `main` and `dco`. Block force
  pushes and protect release tags. Verify the saved rules and their coverage.
- Configure required reviewers for the `preview` and `production` environments.
  Preserve production's branch policy. An environment name alone does not
  require approval. npm preview publication retains the production approval boundary.
- Verify fork workflow approval policy and owner-only operational workflows.
- Prepare private vulnerability reporting, secret scanning, and push protection.
  If a feature is unavailable while private, enable and verify it immediately
  after the owner changes visibility, before the first release or announcement.
  An unavailable setting is an open prerequisite.
- Confirm external mail reaches both security and conduct reporting addresses
  and that responsible people monitor them. DNS routing alone is insufficient.

## Review public material

Review current files, all advertised branches, tags, and retained pull request
refs. Run a credential scanner against a fresh remote mirror and classify every
match. Rotate exposed credentials before handling historical cleanup. A source
tree scan does not cover historical commits, attachments, release assets,
workflow logs, issues, discussions, or organization project boards.

Review historical documents and transcripts for private business and personal
information independently of credential scanning. Record the owner's decision
privately. Removing a current file does not remove its historical versions.

Archive beta feedback privately and preserve its read access and history.
Verify Discord onboarding, support, feedback, resources, and staff boundaries
with a fresh human-operated member account. Preserve subscriber records under
their retention policy.

Review the retained [dependency security constraints](dependency-security.md)
and run `bun audit` against the final lockfile. Do not describe an audit with
retained advisories as clean.

## Verify analytics continuity

Before deploying the community wording:

1. Inspect analytics dashboards, funnels, cohorts, and saved filters for
   `beta_discord_invite_clicked` and `beta_section`.
2. Where historical continuity matters, include both
   `beta_discord_invite_clicked` and `community_discord_invite_clicked`, and both
   `beta_section` and `community_section`. Inspect other renamed source filters.
3. Keep one event per click. Do not emit both names to compensate for a filter.
4. After deployment, verify one new click reaches the expected event and source.
   Confirm the affected reports include it. Record “none found” only after
   inspecting the account; missing access leaves this check pending.

## Release and visibility order

1. Complete the account preparation, public-material review, community checks,
   and required type checks, tests, lint, builds, and package packing.
2. Rehearse publishing with dry runs. Keep `PUBLIC_LAUNCH_READY=false`. Obtain
   explicit approval for the specific preparation pull request before merging it.
3. The repository owner changes visibility manually. Recheck protections and
   enable any security features that required a public repository.
4. Publish the first complete npm release. Verify every package version and
   dist-tag, then test installation in a clean consumer without GitHub credentials.
   Follow the [latest-tag policy](../CONTRIBUTING.md#npm-dist-tag-policy) before
   advertising bare installs. Previews must not create new package names.
5. Set `PUBLIC_LAUNCH_READY=true` only after registry and consumer checks pass.
   Trigger a fresh successful CI completion for the latest `main` commit, such
   as rerunning its CI workflow. Rerunning a production deployment created while
   private retains that event's private flag and stays blocked.
6. Verify the deployed website, docs, analytics, and live GitHub star count.
   Announce availability only after installation works.

`PUBLIC_LAUNCH_READY` is a repository variable, not an application environment
variable or secret. Keep it false through merge and visibility change: public
source does not establish that npm installation works. It can remain true for
normal deployments after launch. Removing this one-time gate is separate cleanup.

The star button omits its count if GitHub cannot return a valid public count.
Rebuild after publication to display the real count. Legacy subscriber links
remain usable; retiring beta copy does not delete subscriber data.

## References

- [Contribution and release workflow](../CONTRIBUTING.md)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [GitHub repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
- [Discord permissions](https://support.discord.com/hc/en-us/articles/206029707-Setting-Up-Permissions-FAQ)
