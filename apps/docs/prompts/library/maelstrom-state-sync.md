---
id: maelstrom-state-sync
prompt_version: 1.0.0
compatibility:
  sdk:
    "@maelstrom-co/client": "0.1.0-alpha.4"
    "@maelstrom-co/protocol": "0.1.0-alpha.4"
---

Diagnose and, if authorized, implement the correct Maelstrom Vessel definition or
runtime-state update path for this case.

Vessel / Instance: [ID OR PATH]
Registration: [FACTORY-DECLARED | RUNTIME-REGISTERED | UNKNOWN]
External state source: [STORE / API / PROPS / OTHER]
Observed conflict or desired change: [DETAILS]
Implementation authorized: [YES / NO]

## Inspect ownership and state

Read the application owner of each relevant value, registration site, installed
SDK version and the matching update API/types/source/tests. Determine whether the
request changes an Instance's Variant/props, republishes a definition, changes
layout, or combines these. Record whether removed Variants or Actions are used by
live Instances, and whether requests/updates may be in flight. Keep unknown
ownership or policy as explicit questions.

## Select the supported path

- The client owns layout state; do not treat the Engine as the source of
  application data or overwrite its decisions as a reconciliation loop.
- Use the inspected factory-aware path for factory-declared Vessels and the
  inspected registration handle/update path for runtime-registered Vessels.
  Confirm method names and return/conflict behavior in the installed version.
- Handle live Variant/Action and in-flight update conflicts explicitly. Do not
  drop or force an update unless the application has an authorized policy.
- Preserve UpdateCoordinator's supported batching; do not reproduce its internals
  unless the app intentionally uses the lower-level client API.
- When processing an Engine response, preserve atomic command order: apply
  `set_layout` before `execute_actions`, so actions may target newly placed
  Instances. Do not add inline size/overflow reconciliation; a changed Chart
  dimension is handled by the existing resize request path.

If implementation is authorized, make the smallest change within the supplied
scope; otherwise make no edits. Add deterministic tests for the selected update
path and conflict behavior. Run affected checks and report exact commands and
outcomes; do not claim live Engine verification from a test double.

Return an ownership map, observed registration/update mechanism with source
anchors, conflict/race handling, changed files or plan, test results, and
unresolved policy questions.