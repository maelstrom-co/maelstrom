---
name: maelstrom-react-migration
description: >-
  Use to migrate one existing React product capability to Maelstrom incrementally
  while preserving its behavior and rollback path. Not for first-project
  onboarding, non-React integrations, or isolated Vessel definition updates.
license: MIT
metadata:
  author: Maelstrom
  version: 1.0.0
---

# Incremental React migration

1. **Establish the baseline.** Inspect the React route/shell, selected capability and its callers, state/API/auth ownership, tests, feature switches, and installed package versions. Record existing behavior and relevant checks before editing.
2. **Select one bounded slice.** Use [`../references/vessel-modeling.md`](../references/vessel-modeling.md) to establish Engine value and derive only observed Variants/Actions. Do not turn every component into a Vessel or introduce generated runtime JSX.
3. **Preserve a reversible boundary.** Read [`../references/rollback.md`](../references/rollback.md) before changing routing or removing a legacy path. Keep migration behind the smallest existing route/flag boundary and retain a working legacy path until the task explicitly authorizes removal.
4. **Integrate in the owning framework.** Keep React bindings/rendering in `@maelstrom-co/react`; preserve app-owned data and side effects. Keep provider credentials server-side and transport concerns in the Connector. Verify each API against installed version evidence.
5. **Test parity before widening.** Run applicable legacy tests and add deterministic tests for Vessel rendering, Action boundaries, and the integration seam. Do not mask weak descriptions with forced layout; use programmatic layout only for intentional deterministic assertions using test-created Instance IDs.
6. **Report the slice.** Run affected typecheck, tests, and check. State what was actually exercised, rollout/rollback procedure, remaining coverage, and any live Engine behavior left unverified.

Follow the user's authorization exactly: a plan-only task makes no edits; an authorized implementation proceeds after inspection unless a material decision remains unresolved. This skill does not authorize deploying or removing the legacy route on its own.