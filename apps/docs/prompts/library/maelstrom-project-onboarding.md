---
id: maelstrom-project-onboarding
prompt_version: 1.0.0
compatibility:
  sdk:
    "@maelstrom-co/react": "0.1.0-alpha.4"
---

Integrate Maelstrom into the existing React application for this goal:

[PRODUCT GOAL]

Repository root: [PATH]

Implement the smallest bounded integration that achieves the goal. Inspect before
editing. Do not stop for another approval unless inspection reveals a material
scope, product, or architecture decision the request did not authorize.

## Inspect and select

1. Read package manifests and lockfile, React entry/root, routing, relevant UI,
   state/data/network code, server boundary, and existing tests. Record installed
   `@maelstrom-co/*` package versions; do not infer them from documentation or a
   version tag.
2. Inventory the existing user-visible capabilities relevant to the goal. For
   each candidate cite the source evidence and a plausible user intent, explain
   whether the Engine can meaningfully select and present it as a unit, and decide
   whether to expose it as a Vessel or keep it internal.
3. Select only the smallest useful pilot. Keep buttons, badges, loading indicators,
   and other implementation details inside their capability unless they are
   independently meaningful product capabilities. A useful single-Variant
   Vessel with no Actions is valid. Do not invent states, operations, or product
   behavior.
4. State any SDK version mismatch or unavailable dependency before choosing APIs.
   Use APIs present in the installed version's source/types/docs, not illustrative
   or remembered APIs.

## Implement

After inspection, implement the bounded integration: define/register only the
selected developer-owned Vessel(s), preserve existing UI and routing where
practical, and add the smallest intent entry point needed for the goal. For React,
prefer the installed `@maelstrom-co/react` APIs where the architecture allows.
Keep the Connector focused on transport and application authentication in its
existing owner. Never expose provider credentials in browser code, request or
print literal credentials, or move provider decisions into the browser. The Engine
selects among developer-authored Vessels; do not replace them with model-generated
JSX. Keep layout state client-owned.

Do not expand into voice, a broad migration, unrelated refactors, or a new auth
system. Do not invent an Engine response or claim an intent was verified against a
real Engine when only a stub or static check was available. Use an existing
supported test connector only when it actually tests the assertion; otherwise
record that live Engine verification needs separately configured infrastructure.

## Verify and report

Run the relevant project typecheck, tests, and lint/format checks. Verify the
bounded UI integration and intent path using the available documented test setup;
report live Engine verification separately. Inspect the final diff for accidental
secrets and unrelated changes.

Return:
- observed architecture and installed package versions;
- candidate inventory with evidence, user intent, Engine value, and expose/internal
  decision;
- selected pilot and its observed state/action contract;
- changed files and exact verification commands/results;
- credential and browser/server-boundary review;
- remaining infrastructure needs, limitations, and rollback path.
