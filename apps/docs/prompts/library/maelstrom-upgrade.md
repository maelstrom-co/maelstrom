---
id: maelstrom-upgrade
prompt_version: 0.1.0
compatibility:
  sdk:
    "@maelstrom-co/react": "0.1.0-alpha.4"
    "@maelstrom-co/client": "0.1.0-alpha.4"
    "@maelstrom-co/protocol": "0.1.0-alpha.4"
---

Upgrade this application between the explicitly requested Maelstrom SDK builds.

From: [EXACT INSTALLED PACKAGE VERSIONS OR "inspect"]
To: [EXACT REQUESTED TARGET VERSIONS]
Goal / known issue: [DETAILS]
Implementation authorized: [YES / NO]

Before editing, inspect manifests, lockfile, all installed `@maelstrom-co/*`
versions, usages of affected exported symbols, existing tests, and available
release/migration documentation. Establish the actual base version from the
resolved dependency tree. Find target-version API evidence in the target package
source/types or versioned docs; state where that evidence comes from. Do not infer
compatibility from a tag, current docs, or a version number alone. If target
sources are unavailable, report that as a blocker for claims about target API
shape rather than fabricating an edit.

Produce an impact table:

`symbol / file | current usage and evidence | target evidence | required change |
risk / confidence`

If implementation is authorized and evidence is sufficient, change only necessary
versions, lockfile and source. Preserve app ownership of state/auth/transport and
provider credential boundaries. Keep `@maelstrom-co/client` framework-neutral.
Do not bundle unrelated upgrades or remove a rollback path without explicit
authorization. Otherwise return a plan without edits.

Run affected typecheck, deterministic tests, and check/lint commands after edits.
Report what was actually run, target API behavior that remains unverified, and a
reversible rollback command/commit strategy. Do not describe proposed tests as
passed; do not claim a live provider or Engine check unless it actually occurred.

Return the impact table, exact versions and source anchors, changed files or
plan, commands/results, compatibility gaps, and rollback procedure.