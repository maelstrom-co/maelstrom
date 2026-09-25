---
id: maelstrom-vessel-modeling
prompt_version: 1.0.0
compatibility:
  sdk:
    "@maelstrom-co/react": "0.1.0-alpha.4"
---

Model this existing capability as a Maelstrom Vessel without changing its product
behavior.

Capability/component: [PATH]
Repository root: [PATH]
Goal: [USER GOAL]

Inspect before editing: the component and its callers, state/data hooks or stores,
API handlers, types, and relevant tests. Read the installed SDK's source/types and
record the exact installed `@maelstrom-co/*` versions before selecting APIs. Treat
the Vessel definition and its descriptions as runtime behavior contracts.

## Decide whether to expose it

Inventory relevant user-visible product capabilities. For each, cite observed
behavior and a plausible user intent, explain what the Engine gains by selecting
and presenting it as a unit, and decide whether to expose it or keep it internal.
Do not turn every React component into a Vessel. Keep buttons, badges, spinners,
and incidental implementation state inside their capability. A simple useful
capability may be a single-Variant Vessel with no Actions. Reject invented states
or Actions even if they would make a more elaborate example.

For a selected candidate, produce an observed behavior table:

| UI state or operation | Source evidence | Props/data | Side effects |
| --- | --- | --- | --- |

Use code references precise enough for another developer to check. If evidence is
missing or behavior is ambiguous, report the gap instead of filling it in.

## Model and implement

1. Define Variants only for meaningfully distinct, legal, user-visible states
   supported by observed behavior. Record the evidence for each boundary.
2. Define Actions only for existing legal operations available in that active
   Variant. For each, identify parameters, application-owned effects, any real
   target Variant, and duplicate/retry risk.
3. Treat descriptions as product-language contracts: explain the capability and
   when it is useful, not the component's implementation. Preserve the existing
   component/rendering where practical and use the installed SDK's typed Vessel
   props/APIs.
4. Keep business and API effects in application-owned handlers. Preserve existing
   validation and confirmation behavior. Do not mark an accumulating, destructive,
   or otherwise side-effecting operation idempotent without evidence that the
   underlying operation is genuinely idempotent. Do not use casts to conceal an
   invalid definition.
5. Change only the selected capability and necessary registration/integration
   seams. Do not broaden into an application-wide migration.

## Verify and report

Add or update tests for the selected Variant rendering and each exposed Action
boundary and handler effect. Run relevant typecheck, tests, and lint/format checks.
Report exact commands and results; do not claim unrun checks passed.

Return the capability inventory and decision, evidence-backed state/operation
table, final Vessel contract, changed files, verification results, side-effect and
idempotence rationale, and any behavior that could not be mapped safely.
