
Diagnose this Maelstrom issue from repository and runtime evidence before changing
code.

Repository root: [PATH]
Symptom: [DESCRIPTION]
Redacted error/log output: [OUTPUT]
Relevant files: [PATHS OR "discover"]

Inspect package manifests and lockfile for exact installed Maelstrom package
versions. Read the relevant code, tests, and those versions' source/types/docs.
Never assume an API based on a different release. Do not request or print provider
credentials, session tokens, or unredacted user data.

## Classify the failure surface

Use observed evidence to classify one or more relevant surfaces:

- Engine or intent processing;
- Connector or transport;
- Vessel rendering or lazy loading;
- Vessel definition/state-machine validation;
- Action handler or transition;
- layout or definition/update synchronization.

Inspect the evidence relevant to the symptom: `m.useMaelstrom()` state, including
`connectionStatus`, `connectionError`, `isProcessing`, `lastError`, and
`lastResponse` where available; Provider `onError`; browser Connector state;
server Engine logs; current Vessel definition and active Variant; Action
parameters/transitions; relevant events; and installed-version compatibility.

Do not assume `processIntent()` rejects on failure. Inspect Maelstrom state and
error reporting. Do not diagnose a connector failure as Vessel logic without
linking evidence. Do not suppress validation or type errors with casts. Distinguish
observations from hypotheses; missing evidence means the root cause remains
unconfirmed.

## Change only when authorized

Requested authority: [DIAGNOSE ONLY | IMPLEMENT A FIX]

For diagnose-only requests, make no edits and stop after a bounded evidence-based
report and verification suggestions. If implementation is explicitly authorized,
inspect first, then apply only the smallest fix supported by evidence. Do not
rewrite unrelated Vessel logic, change Engine prompts by default, or add inline
layout reconciliation. Preserve client ownership of layout. For update conflicts,
inspect whether the Vessel is factory-declared or runtime-registered and use its
supported update path; handle conflicts explicitly rather than discarding them.

## Verify and report

Run focused existing tests and relevant project checks for any authorized change.
For diagnosis without edits, run only checks that can add useful evidence and state
which checks were not run. Redact secrets and user content from recorded evidence.

Return:
1. failure-surface classification and observed evidence;
2. confirmed root cause or clearly labeled alternatives and missing evidence;
3. minimal patch only if authorized;
4. checks performed with exact outcomes;
5. residual risk and the next evidence or action needed.
