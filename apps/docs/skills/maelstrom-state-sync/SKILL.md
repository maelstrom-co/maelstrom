---
name: maelstrom-state-sync
description: >-
  Use when changing a Maelstrom Vessel definition or synchronizing its runtime
  Variant/props/layout state, especially across registrations or live update
  conflicts. Not for unrelated application state management or generic debugging.
license: MIT
metadata:
  author: Maelstrom
  version: 0.1.0
---

# Vessel definition and runtime state synchronization

1. **Locate ownership and mechanism.** Inspect the external data owner, Vessel registration site, live Instance usage, in-flight updates, installed versions, and matching update API/types/source/tests. Read [`../references/state-sync.md`](../references/state-sync.md) before selecting an update path.
2. **Classify the requested change.** Distinguish Instance Variant/props, definition republishing, and layout changes. Use the inspected factory-aware update path for factory-declared Vessels and the retained handle/update path for runtime-registered Vessels; verify actual names and conflict behavior in this version.
3. **Handle conflicts explicitly.** Consider live Instances that use a removed Variant or Action and updates already in flight. Preserve supported batching; do not force, drop, or reconcile conflicts without an app-authorized policy. If definition changes add/remove operations, read [`../references/actions-and-idempotence.md`](../references/actions-and-idempotence.md).
4. **Preserve orchestration invariants.** The client owns layout state. Process a response atomically: apply `set_layout` before `execute_actions`. Do not add inline size/overflow reconciliation; whole Chart dimension changes belong to the existing resize request path.
5. **Verify and report.** Make only the authorized bounded change. Add deterministic tests for the selected path and conflict outcome; use real test-created Instance IDs. Run affected checks and distinguish test doubles from live Engine verification. Keep unknown conflict policy explicit rather than choosing silently.

A plan-only request stops before edits. This skill does not assign ownership of application data to Maelstrom.