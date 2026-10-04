---
id: maelstrom-react-inventory
prompt_version: 0.1.0
compatibility:
  sdk:
    "@maelstrom-co/react": "0.1.0-alpha.4"
---

Create an evidence-backed plan for integrating Maelstrom into an existing React
application for this goal:

[PRODUCT GOAL]

Repository root: [PATH]

This is a **read-only planning task**. Inspect, reason, and report; make zero
edits. Do not create, modify, format, or delete files, run generators, install
packages, or apply the proposed integration. If the requested goal cannot be
planned safely from available evidence, report what is missing without changing
the repository.

## Inspect the application and SDK

1. Read workspace/package manifests and lockfile, application entry and root,
   routing, relevant UI, state/data/network code, server boundaries, and tests.
   Record the installed versions of every relevant `@maelstrom-co/*` package;
   distinguish declared ranges from resolved versions.
2. Inspect source, types, and tests for those installed versions. Establish the
   actual APIs and supported behavior from that evidence. Do not rely on samples,
   memory, or APIs from another release. Record incompatibilities or unavailable
   packages; do not install or upgrade anything.
3. Trace each capability being considered from rendered interface through its
   data owner and handlers to any external effects. Cite repository paths and
   symbols/lines where practical. Mark conclusions as observed, inferred, or
   unknown.

## Inventory and choose a pilot

For each relevant user-visible capability, report:

| Capability and observed behavior | Source evidence | Plausible user intent | Engine value as a unit | Decision |
| --- | --- | --- | --- | --- |

Decide whether each candidate belongs in the Chart as a Vessel or should remain
an internal component. Engine value means that selection and placement by intent
can help the user; a React component's existence alone is not a reason to expose
it. Keep controls, badges, spinners, and incidental state inside their capability.
Choose the smallest useful pilot, and explain why other candidates are deferred or
rejected. A useful single-Variant Vessel with no Actions is valid. Do not invent
product capabilities, state, or operations to make the proposal look richer.

For the proposed pilot, give an observed behavior/ownership table:

| State or operation | Evidence | Props/data owner | Side effects and owner |
| --- | --- | --- | --- |

Name only legal states and operations supported by evidence. If state boundaries,
selection value, or side-effect ownership are ambiguous, identify the evidence
needed rather than guessing.

## Plan, do not implement

Describe a bounded sequence of intended changes, likely files/seams, and tests,
without writing them. The plan must:

- preserve current rendering, routing, state ownership, and user-visible behavior
  unless the stated goal explicitly authorizes a change;
- define Variants only for observed, meaningfully distinct legal states;
- expose Actions only for existing legal operations, in the Variants where they
  are available, and keep business/API effects in application-owned handlers;
- avoid idempotence claims without evidence the underlying effect is genuinely
  idempotent, and avoid inventing idempotence keys or retry behavior;
- preserve the existing Connector and authentication owner; never put provider
  credentials in browser code or move provider decisions into the browser;
- keep Engine-selected capabilities developer-authored; do not propose
  model-generated JSX or client-owned Engine decisions;
- avoid broad migrations, voice work, unrelated refactors, and inline layout
  reconciliation;
- call out live Engine verification separately if only a stub or local test path
  is available.

If implementation would require a new product, architecture, or scope decision,
mark it as a blocker for the repository owner. Do not make that decision yourself.

## Report

Return the observed application architecture and exact package versions; the
candidate inventory and expose/internal decisions; the pilot behavior and
ownership tables; API/version constraints; a bounded implementation and test
plan; likely rollback steps; and unknowns or live-service requirements. State
explicitly that no files were changed and list the read-only commands used.
