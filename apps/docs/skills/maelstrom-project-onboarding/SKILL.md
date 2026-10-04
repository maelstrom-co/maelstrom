---
name: maelstrom-project-onboarding
description: >-
  Use when introducing Maelstrom to an existing application, scaffolding its
  first bounded integration, or orienting a project before choosing a pilot.
  Not for a focused Vessel model, React migration, incident diagnosis, or a task
  whose primary outcome is instrumentation, state synchronization, or voice.
license: MIT
metadata:
  author: Maelstrom
  version: 0.1.0
---

# Maelstrom project onboarding

Own the integration from repository inspection through the authorized bounded change and verification. A standalone onboarding prompt remains complete on its own; do not construct or revise prompt bodies from this skill.

1. **Inspect first.** Read the consumer's workspace instructions, manifests and lockfile, app entrypoints, UI/data flow, server/browser boundary, tests, and existing Maelstrom use. Record exact installed package versions. Confirm every proposed public symbol in installed exports/types/source/tests or matching docs; stop on unsupported or ambiguous contracts rather than guessing.
2. **Choose a real capability.** Inventory user-visible capabilities and observed evidence. Choose only a capability the Engine can meaningfully select and present for a plausible intent. Keep incidental controls and implementation details inside their owning capability; a simple single-Variant Vessel without Actions is valid. Read the bundled [`references/vessel-modeling.md`](references/vessel-modeling.md) before making that choice.
3. **Respect ownership.** Preserve app-owned data, auth, authorization, and effects; keep the Connector transport-focused, client layout client-owned, and provider secrets server-side. Read the bundled [`references/connectors-and-auth.md`](references/connectors-and-auth.md) only when configuring custom transport or application authentication.
4. **Plan then act within authorization.** Bound files and behavior to the user's goal. Plan-only means no edits. If implementation is authorized, proceed after inspection without a redundant approval pause; ask only if discovered facts reveal a material decision not authorized by the task.
5. **Verify and report.** Add deterministic tests at the changed boundary. Run affected project checks. Distinguish actual local checks from live Engine/provider behavior not exercised. Report versions, evidence anchors, changed files, commands/results, limitations, and rollback where relevant.

Do not redesign the application, add an SDK/runtime layer, or claim that a scaffold communicates with a live Engine merely because it typechecks.