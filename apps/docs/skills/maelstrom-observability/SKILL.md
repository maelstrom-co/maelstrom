---
name: maelstrom-observability
description: >-
  Use when adding bounded telemetry or diagnostic event reporting to a Maelstrom
  integration. Not for diagnosing one incident, changing product state, or
  implementing general application analytics unrelated to Maelstrom events.
license: MIT
metadata:
  author: Maelstrom
  version: 1.0.0
---

# Focused event observability

1. **Name the operational question.** Inspect the current telemetry conventions, integration lifecycle, installed SDK exports/types/source/tests, and exact package versions. Choose only event surfaces evidenced in that version.
2. **Keep the signal bounded.** Map the smallest relevant supported events to existing metrics/logging. Do not add a second product-state store, unsupported event names, unnecessary high-cardinality fields, or a generic telemetry framework.
3. **Protect data.** Before handling request fields, credentials, intent text, Vessel props, user data, or raw errors, read [`../references/security-and-telemetry.md`](../references/security-and-telemetry.md). Prefer stable identifiers already provided; define redaction and retention within existing app policy.
4. **Own listener lifetime.** Tie subscription cleanup to an observed application lifecycle. Keep telemetry separate from Connector transport and orchestration policy.
5. **Verify only what was tested.** Add deterministic mapping, redaction, and cleanup tests where applicable. Run affected typecheck, tests, and check; report source anchors and exact results. Do not claim deployed delivery from a fake sink or local run.

Follow authorization; plan-only work makes no edits. If the SDK has no evidenced event for the requested question, report the gap rather than inventing one.