---
id: maelstrom-observability
prompt_version: 1.0.0
compatibility:
  sdk:
    "@maelstrom-co/client": "0.1.0-alpha.4"
---

Add focused observability to this Maelstrom integration.

Question or operational goal: [GOAL]
Telemetry conventions: [SYSTEM OR "inspect"]
Relevant integration paths: [PATHS OR "discover"]
Implementation authorized: [YES / NO]

Inspect package versions and the current integration before changing code. Find
the event types and payloads in the installed SDK exports, declarations, source,
tests, or matching API docs. Trace how listeners are registered and disposed.
Subscribe only to concrete supported events needed to answer the goal. Candidate
surfaces in the current client include connection status/attempt/error events,
request processing start/completion, coalesced update flushes, and Vessel
registration; verify the chosen names and payload fields against this checkout
before using them. Do not assume every object exposes every event.

Keep reporting separate from product state and Connector transport. Prefer a
small event-to-metric/log mapping with stable identifiers only when already
provided. Do not log credentials, authorization headers, prompt/intent contents,
Vessel props, user data, or raw errors that may contain them by default. Define
redaction and retention using the application's existing telemetry conventions.
Dispose subscriptions with their owner; do not add a parallel state store or
high-cardinality labels without evidence and a reason.

If authorized, implement only the requested bounded instrumentation after
inspection. Add deterministic tests for event mapping, redaction, and cleanup
where applicable. Run affected typecheck, tests, and check. Report exact source
anchors, files, commands and results; distinguish local test evidence from live
telemetry delivery. If no suitable supported event exists, report the gap rather
than inventing an SDK event.

Return the selected events and why, event-to-signal mapping, privacy choices,
lifecycle cleanup, test evidence, and unverified deployment work.