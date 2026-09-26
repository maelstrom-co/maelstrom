---
id: maelstrom-testing
prompt_version: 0.1.0
compatibility:
  sdk:
    "@maelstrom-co/react": "0.1.0-alpha.4"
    "@maelstrom-co/client": "0.1.0-alpha.4"
    "@maelstrom-co/protocol": "0.1.0-alpha.4"
---

Build and execute a deterministic migration-parity test plan for this Maelstrom
capability.

Legacy behavior: [PATHS OR "derive from tests and implementation"]
Maelstrom implementation: [PATHS]
Test stack: [DISCOVER]
Requested scope: [PLAN ONLY | IMPLEMENT TESTS]

Inspect the installed Maelstrom versions, existing behavior/tests, test setup, and
available test connectors before proposing assertions. Derive the behavior
contract from actual app code and tests; do not invent product behavior. Use only
APIs and fixtures present in the checked-out version. A stubbed Connector or
Engine response is deterministic local evidence, not a live Engine check.

Build a focused matrix covering relevant layers:

1. Vessel contract: meaningful Variants, props, legal Actions, validation and
   action-handler outcomes. Do not require artificial Actions or extra Variants.
2. Rendering and application boundary: preserve legacy visible behavior, data
   ownership, authorization, and side-effect handling. Test failures as well as
   success where applicable.
3. Layout/update integration: use programmatic layout only when deterministic
   placement is the assertion; use real Instance IDs created by the test setup.
   Do not mask weak descriptions with a forced layout.
4. Intent-driven behavior: propose bounded representative intents and assert
   user-visible outcomes/invariants, not exact coordinates when the Engine may
   choose. Execute only against infrastructure explicitly provided and report
   whether it is a stub or live service.
5. Legacy parity: retain and run applicable existing tests; identify behavior
   without an existing test rather than declaring parity from inspection alone.

If plan-only, make no edits or test claims. If test implementation is authorized,
add only tests in scope, then run the affected test/typecheck/check commands and
report exact results. Clearly separate existing tests run, tests added but not
run, recommended scenarios not executed, and live checks unavailable. Automated
or behavioral evaluation frameworks are outside this task; do not add one.

Return the matrix, concrete assertions and evidence sources, changed test files
(if authorized), commands/results, uncovered risks, and any live-service work
left unrun.