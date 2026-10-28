---
id: maelstrom-sdk-scaffold
prompt_version: 0.1.1
compatibility:
  sdk:
    "@maelstrom-co/react": "^0.1.0"
    "@maelstrom-co/client": "^0.1.0"
    "@maelstrom-co/protocol": "^0.1.0"
---

Integrate the Maelstrom SDK into this application for the following bounded goal:

[PRODUCT GOAL]

Repository: [PATH]
App/package: [PATH OR "discover"]
Installed Maelstrom versions: [KNOWN OR "inspect manifests and lockfile"]

## Inspect before implementation

1. Read the app entrypoints, dependency manifests and lockfile, current UI/data
   flow, server/browser boundaries, and tests. Record exact installed versions;
   do not infer versions from a tag, docs example, or this prompt's compatibility
   metadata.
2. Trace the public API from the installed package's exports, declaration files,
   source and version-matched docs. Follow existing consumers and tests where
   useful. If the proposed symbol is absent or its contract is unclear, stop that
   part and report the evidence rather than substituting a remembered API.
3. Keep `@maelstrom-co/client` framework-independent. Put React rendering and
   React bindings in `@maelstrom-co/react`; do not import React into client code.
   Use developer-authored Vessels as capabilities, not generated runtime JSX.
4. Identify whether the request authorizes implementation. If so, make the
   smallest bounded change after inspection; do not add an approval round unless
   inspection reveals an unresolved material decision.

## Implement and verify

Preserve existing product behavior and app-owned state, authentication, and
network effects. The Connector carries transport; it is not an Action handler or
product policy layer. Keep provider secrets on the server. Do not claim a live
Engine check when only types, tests, stubs, or local rendering were exercised.

Run the affected project's typecheck, tests, and check/lint commands. Add focused
deterministic tests for the integration boundary. Report actual commands and
results separately from recommended checks not run.

Return exact package versions and source/export anchors, changed files, the
bounded API usage and ownership boundaries, tests/commands/results, unverified
behavior, and remaining integration work. Do not produce a general SDK tutorial
or rewrite unrelated framework-neutral SDK code.
