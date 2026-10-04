---
name: maelstrom-debugging
description: >-
  Use to classify and diagnose a concrete Maelstrom failure from inspected
  runtime state, logs, configuration, and code evidence before proposing a fix.
  Not for feature implementation, general onboarding, or adding observability.
license: MIT
metadata:
  author: Maelstrom
  version: 0.1.0
---

# Evidence-led debugging

1. **Preserve the symptom.** Capture a minimal reproduction and relevant redacted observations. Read [`../references/debugging-evidence.md`](../references/debugging-evidence.md) before deciding which failure surface the symptom implicates.
2. **Inspect, do not infer.** Check installed package versions and trace the implicated UI/Vessel, connection/Connector, processing state, validation, Action, layout, or update path. Classify only from evidence. `processIntent()` not rejecting is not evidence that processing succeeded; observe the actual result/error state.
3. **Separate hypotheses.** Identify evidence supporting and contradicting the leading explanation. When evidence does not distinguish causes, state what observation is missing rather than presenting a definite root cause.
4. **Bound the remedy.** If edits are authorized, change only the implicated configuration or code path and add a deterministic regression test. Do not rewrite an unrelated Vessel, suppress a contract error with a cast, or log secrets to obtain evidence. For transport/auth evidence read [`../references/connectors-and-auth.md`](../references/connectors-and-auth.md); for definition/update conflicts read [`../references/state-sync.md`](../references/state-sync.md).
5. **Verify and report.** Run relevant local checks and report exact commands/outcomes, evidence anchors, changed files, alternate hypotheses, and unrun live checks. A stub or local test is not a live Engine/provider diagnosis.

A plan-only request ends with diagnosis and plan. Do not silently convert it into authorization to edit.