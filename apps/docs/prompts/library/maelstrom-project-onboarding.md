---
id: maelstrom-project-onboarding
prompt_version: 0.2.1
compatibility:
  sdk:
    "@maelstrom-co/react": "^0.1.0"
---

Help me get started with Maelstrom. Ask what I want to build and whether I am
starting a new application or integrating an existing one, unless that is already
clear from the conversation. Inspect the project and plan a bounded integration
for this goal:

[PRODUCT GOAL]

Repository root: [PATH]

Requested authority: [PLAN ONLY | IMPLEMENT THE BOUNDED INTEGRATION]

If authority is omitted or the placeholder is unchanged, use PLAN ONLY.
For PLAN ONLY, make no edits or installations. Report the selected pilot and
verification plan, then stop. For IMPLEMENT THE BOUNDED INTEGRATION, inspect first
and implement the smallest useful pilot. Ask only when inspection reveals a
material decision outside the authorized goal.

## Inspect and select

For a new app, inspect the destination before creating anything. Start from the
runnable React starter at https://github.com/maelstrom-co/react-starter#run
when React fits the goal. Its deterministic local planner needs no provider key;
do not describe that run as live model verification. For PLAN ONLY, describe the
starter and checks without downloading, installing, or editing. For an authorized
implementation, use an empty destination, follow its README, then adapt the
smallest useful capability to the stated goal. Preserve existing files when the
destination is not empty. If the installed maelstrom skill is available, use its
entry workflow and selected procedure; this prompt also works without skills.

1. Read package manifests and lockfile, application entry/root, routing, relevant UI,
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

## Implement only when authorized

For IMPLEMENT THE BOUNDED INTEGRATION, define/register only the
selected developer-owned Vessels, preserve existing UI and routing where
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

For an implemented change, run the relevant project typecheck, tests, and lint/format checks. Verify the
bounded UI integration and intent path using the available documented test setup;
report live Engine verification separately. Inspect the final diff for accidental
secrets and unrelated changes. For PLAN ONLY, distinguish proposed checks from
checks actually run and state that no files changed.

Return:
- observed architecture and installed package versions;
- candidate inventory with evidence, user intent, Engine value, and expose/internal
  decision;
- selected pilot and its observed state/action contract;
- changed files and exact verification commands/results;
- credential and browser/server-boundary review;
- remaining infrastructure needs, limitations, and rollback path.
