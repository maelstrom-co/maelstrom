---
name: maelstrom-vessel-modeling
description: >-
  Use when selecting an existing user-visible capability and extracting its
  evidence-backed Vessel, Variant, and Action contract. Not for broad project
  onboarding, React migration sequencing, runtime definition updates, or debugging.
license: MIT
metadata:
  author: Maelstrom
  version: 1.0.0
---

# Maelstrom Vessel modeling

1. **Trace existing behavior.** Inspect the capability, callers, state/data owners, side effects, tests, and installed SDK version. Record code evidence for each meaningful visible state and legal user operation.
2. **Decide whether it is a Vessel.** Apply [`../references/vessel-modeling.md`](../references/vessel-modeling.md): name the plausible user intent and why the Engine benefits from selecting this capability as a unit. Do not expose every React component. Keep buttons, badges, spinners, and other implementation details internal unless independently meaningful. A single-Variant, no-Action Vessel is acceptable.
3. **Model only observed behavior.** Map distinct legal user-visible states to Variants and existing operations to Actions. Treat descriptions as runtime contracts. Do not invent states, Actions, parameters, or transitions. Read [`../references/actions-and-idempotence.md`](../references/actions-and-idempotence.md) before modeling effects, retries, or duplicate execution.
4. **Implement only when authorized.** Keep product/API side effects in app-owned handlers. Use installed, version-verified APIs and preserve the existing UI where practical. If authorization is plan-only, return the contract proposal without edits.
5. **Verify.** Add deterministic tests for relevant Variants, Action boundaries, and side-effect outcomes. Report evidence, edits, commands/results, and behavior not verified. Never infer live Engine success from unit tests.

The skill owns the modeling workflow, not a prompt generator: do not assemble, append, or rewrite standalone prompt content.