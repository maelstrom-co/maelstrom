# Prompts

## Prompt template library

The templates below are written to be **code-aware**: they tell an agent what repository evidence to inspect, what it must not assume, and exactly what output constitutes completion.

**Template: onboarding / integration assessment**

```plain
You are integrating Maelstrom into an existing application.

Goal
----
Determine the smallest safe path to introduce Maelstrom for:
[USER/PRODUCT GOAL]

Repository
----------
Root: [REPO PATH]
Primary application: [APP/PACKAGE]
Framework: [KNOWN FRAMEWORK OR "discover it"]
Current Maelstrom version: [VERSION OR "inspect package.json/lockfile"]

Before proposing changes:
1. Inspect package.json, lockfile, application entrypoints, routing, major UI
   components, state management, API/network layer, and test setup.
2. Confirm which @maelstrom-co packages and exact versions are already installed.
3. Identify the browser/server boundary.
4. Apply the proposed `references/vessel-modeling.md` selection rubric before
   choosing candidates. It is not an existing reference yet, so use the criteria
   below in this workflow.
5. Inventory existing user-visible product capabilities before selecting candidates.
   For each candidate, report:
   - capability and a plausible example user intent,
   - observed behavior/evidence in code,
   - Engine value from selecting and presenting it as a unit,
   - expose as a Vessel or keep internal, with rationale,
   - observable states, user actions, side effects, data dependencies and
     approximate minimum layout requirements when exposed.
6. Keep individual buttons, badges and incidental spinners internal unless they
   are independently selectable product capabilities. A simple weather card can
   be a valid single-Variant Vessel; do not invent Variants or Actions to justify it.
7. Do not invent product states or actions that are not present in the code.

Use these Maelstrom principles:
- Maelstrom orchestrates developer-authored components; do not replace existing UI
  with model-generated JSX.
- Model discrete UI states as Variants and legal operations/transitions as Actions.
- Treat Vessel/Variant/Action descriptions as runtime behavior contracts.
- Keep LLM/provider credentials on the server.
- Prefer @maelstrom-co/react for a React application unless the existing architecture
  requires lower-level client APIs.

Return:
A. Current architecture summary
B. Candidate inventory with example intent, observed evidence, Engine value,
   expose-or-internal decision, and rationale
C. Recommended pilot
D. Exact files likely to change
E. Risks/unknowns
F. Verification plan
G. No code changes yet unless [ALLOW_EDITS=true]
```

This template encodes Maelstrom's component-preserving model, state-machine abstraction, runtime descriptions and browser/server boundary.

**Template: private-beta package authentication**

```plain
Configure this repository to install Maelstrom's private beta safely.

Inputs
------
Package manager: [npm | pnpm | bun | yarn]
Requested package/version: [e.g. @maelstrom-co/react@[EXACT VERSION OR TAG]]
CI platform: [GitHub Actions | other]
Existing package-manager config: [PATH OR "discover"]
Secret environment variable name: [DEFAULT: GH_PACKAGES_TOKEN]

Requirements
------------
1. Inspect the existing package-manager and CI configuration first.
2. Configure the @maelstrom-co scope for GitHub Packages.
3. Reference the token only through an environment variable/CI secret.
4. NEVER:
   - ask me to paste the actual token into this conversation,
   - write a literal token into .npmrc/.yarnrc/package.json/source code,
   - print an existing secret,
   - commit a generated credential.
5. Use the requested exact beta version when one is supplied.
6. Do not silently change unrelated registry configuration.
7. Show the exact files modified and explain how to verify registry access.
8. Check git diff for accidental credential material before completion.

Output:
- configuration patch,
- local setup command using a placeholder,
- CI secret/config changes,
- verification command,
- secret-leakage check,
- rollback instructions.
```

This reflects the current beta installation flow: packages are hosted on GitHub Packages; a classic token with `read:packages` is used; the token should be stored outside the project and referenced through an environment variable; exact versions are preferred for reproducible preview testing.

**Template: SDK scaffold**

```plain
Add the smallest working Maelstrom React shell to this application.

Inputs
------
App entry: [PATH]
Vessel entries: [PATHS OR "create one minimal pilot"]
Connector URL/config source: [VALUE OR CONFIG PATH]
Layout mode: [grid | tiling | "choose based on existing layout"]

Tasks
-----
1. Inspect the current React root and dependency versions.
2. Reuse existing components where possible.
3. Define/register the supplied Vessel(s).
4. Create a single shared createMaelstrom(...) instance.
5. Mount <m.Provider> and <m.Chart>.
6. Wire a connector using existing application configuration.
7. Add an intent submission path using m.useMaelstrom().processIntent.
8. Disable/indicate submission appropriately when disconnected or processing.
9. Preserve the application's current routing and unrelated UI.
10. Run TypeScript and the existing test/lint commands.

Return:
- changed files,
- final relevant TypeScript/React code,
- how the browser/server flow works,
- validation results,
- remaining integration work.
```

The current React Quick Start uses `createMaelstrom({ vessels })`, `<m.Provider connector={...}>`, `<m.Chart />`, `WebSocketConnector`, and `m.useMaelstrom().processIntent`; the high-level React package also re-exports common helpers/connectors.

**Template: component → Vessel state machine**

```plain
Convert this existing React component into a Maelstrom Vessel without changing
its product behavior.

Component:
[FILE/PATH]

Related files to inspect:
[CALLERS, TYPES, STORE, HOOKS, TESTS, API CLIENTS]

Procedure
---------
1. Read the component, all important callers, state hooks/stores and tests.
2. Apply the proposed `references/vessel-modeling.md` selection rubric before
   modeling. It is not an existing reference yet; use the criteria here.
3. Decide whether this is an existing user-visible product capability the Engine
   can select and present as a unit. Record a plausible user intent, observed
   evidence, Engine value, expose-or-internal decision, and rationale. Keep
   implementation details internal; a simple capability can be a single-Variant
   Vessel without invented Actions.
4. If it is a Vessel candidate, build an observed behavior table:
   UI state | evidence in code | props/data | available user operations.
5. Propose Variant boundaries only where the UI has meaningfully distinct legal
   states. Do not create Variants for incidental implementation state.
6. Propose Actions from existing user/product operations.
7. For each Action identify:
   - parameters and types,
   - side effects,
   - target Variant if any,
   - whether it is genuinely idempotent.
8. Never mark an accumulating/destructive mutation idempotent merely to suppress
   duplicate execution.
9. Write Vessel, Variant and Action descriptions in product-language terms:
   what capability exists and when it is useful, not how the React component is
   built.
10. Preserve the existing component when practical and adapt it with
    TypedVesselProps.
11. Keep business/API side effects in app-owned Action handlers.
12. Add tests for Variant rendering, typed Action invocation and side-effect
    handlers.

Return:
- behavior/state table,
- proposed state machine,
- Vessel definition,
- React adaptation,
- action-runner code if needed,
- tests,
- any behavior that could not be mapped safely.
```

Variants are legal UI states and active-variant actions define what the Engine may invoke; Action definitions support typed parameters, transitions, and idempotence. Maelstrom specifically advises marking pure navigation differently from append/accumulate behavior.

**Template: application authentication and connector design**

```plain
Design Maelstrom transport authentication for this application.

Existing auth:
[SESSION COOKIE | JWT | OAUTH TOKEN | CUSTOM]
Existing backend/gateway:
[DETAILS]
Current connector:
[WEBSOCKET | HTTP | NONE | CUSTOM]
Maelstrom engine location:
[SERVER DETAILS]

First inspect:
- current auth/session code,
- connector or network layer,
- server route/gateway configuration,
- browser environment variables,
- server environment variables.

Constraints:
1. Treat the Connector as transport infrastructure.
2. Do not put Vessel mutation, layout policy or product decision logic inside it.
3. Do not expose the LLM provider/API key to browser code.
4. Reuse the application's existing session/auth mechanism where technically valid.
5. Never log tokens or credentials.
6. Explicitly handle credential expiry, authorization rejection, reconnect behavior,
   and terminal versus retryable connection errors when applicable.

Return:
A. sequence diagram
B. browser responsibilities
C. server responsibilities
D. proposed connector changes
E. failure/reconnect behavior
F. security review
G. tests
```

Maelstrom's connector guidance separates transport from orchestration and application behavior, while production guidance assigns provider credentials to the server. Connection events also expose retry/circuit-breaker state that can be incorporated into robust recovery behavior.

**Template: optional voice integration**

```plain
Plan a voice integration for this existing Maelstrom application. Voice is optional;
do not add it unless the requested product capability requires it.

Product goal:
[USER GOAL]
Existing application shell and entry points:
[PATHS OR "inspect"]
Installed Maelstrom and voice package versions:
[VERSIONS OR "inspect manifests and lockfile"]
Provider and deployment choice:
[OPENAI REALTIME | LIVEKIT CASCADE | OTHER | UNDECIDED]
Backend authentication and authorization model:
[DETAILS OR "inspect existing routes and auth"]

Inspect the React shell, session/input UI, current Maelstrom intent flow, package
versions, server routes, and deployment setup before recommending changes. If the
provider or deployment is undecided, compare only the relevant supported options
and identify the decision needed; do not assume a provider.

Keep these responsibilities distinct:
- Browser/React: voice controls, connection/error presentation, and UI appropriate
  to the selected integration. Voice UI is not automatically a Vessel.
- Realtime: provider adapter/session lifecycle and turn-taking behavior.
- Server/deployment: provider credentials, minting, and any provider-specific
  worker. Browser code must never hold provider secrets. Authentication and
  authorization for mint routes remain application-owned.
- Voice supplies natural-language intent; the Engine remains the planner and uses
  client-owned state. Turn mode is runtime behavior, not a fixed provider flag.

Use the canonical architecture and ADRs rather than copying evolving API details:
- docs/realtime-voice-architecture.md
- docs/adr/0001-realtime-providers-come-in-two-kinds.md
- docs/adr/0002-credential-custody-is-a-dependency-edge.md
- docs/adr/0003-turn-taking-is-provider-neutral.md
Consult provider-specific build/API guidance only after the provider and deployment
are selected.

Return:
A. existing-to-proposed integration map, separated into browser/React,
   realtime, and server/deployment responsibilities
B. decisions, assumptions, and unresolved provider/auth questions
C. bounded implementation plan with files/packages in scope
D. security and turn-taking risks, including runtime fallback behavior where relevant
E. verification plan for existing package versions and selected deployment
Do not edit code unless [ALLOW_EDITS=true].
```

**Template: event handling and observability**

```plain
Instrument this Maelstrom integration.

Telemetry system:
[DATADOG | OTEL | SENTRY | CUSTOM | CONSOLE FOR DEVELOPMENT]
Required signals:
[LATENCY / CONNECTION / ERRORS / VESSEL LIFECYCLE / UPDATE BATCHING / ALL]
Code location:
[PATH]

Inspect available Maelstrom client/runtime objects and add the smallest event
subscriptions necessary.

Cover, where accessible:
- connection_status_changed
- connection_attempt / connection_error
- circuit_opened / half_open / closed
- processing_started
- processing_completed, including durationMs/requestId
- request errors
- updates_flushed, including rawCount vs coalesced updates
- vessel_registered / vessel_unregistered

Requirements:
- unsubscribe/dispose correctly,
- avoid logging prompt contents, credentials or sensitive user data by default,
- attach stable request/session identifiers where already supplied,
- do not introduce a second source of application state merely for telemetry,
- preserve existing observability conventions.

Return:
1. instrumentation code,
2. event-to-metric/log mapping,
3. privacy/redaction decisions,
4. lifecycle cleanup,
5. tests or local verification steps.
```

The listed event families and payload fields are present in the current client reference.

**Template: state synchronization**

```plain
Analyze and implement Maelstrom state synchronization for:

Vessel: [ID/PATH]
Registration model: [FACTORY-DECLARED | RUNTIME-REGISTERED | UNKNOWN]
External state source: [STORE/API/WEBSOCKET/PROPS]
Observed problem: [DESCRIPTION]

First determine:
1. Who currently owns each piece of state?
2. Is the Vessel listed in createMaelstrom({ vessels }) or added with registerVessel()?
3. Are we changing a live instance's state, republishing the Vessel definition, or both?
4. Can an update remove a Variant or Action currently used by a live instance?
5. Is an update batch already in flight?
6. What update reason should the client observe?

Rules:
- Do not assume the Engine owns layout state.
- For a factory-declared Vessel, use the supported factory-aware update path.
- For a runtime-registered Vessel, use the handle returned by registerVessel().
- Handle update conflicts explicitly; never discard them silently.
- Do not manually reproduce UpdateCoordinator batching unless the application is
  intentionally operating at the lower-level client API.

Return:
- ownership diagram,
- exact update mechanism selected and why,
- TypeScript changes,
- conflict handling,
- concurrency/race analysis,
- tests.
```

The client owns layout state; update reasons are coalesced by `UpdateCoordinator`; factory-known and runtime-only Vessels have separate republishing paths; runtime updates can report conflicts rather than simply applying unsafe definition changes.

**Template: debugging**

```plain
Diagnose this Maelstrom issue using evidence before changing code.

Symptom:
[DESCRIPTION]

Error/log output:
[PASTE REDACTED OUTPUT]

Relevant files:
[PATHS]

Installed Maelstrom package versions:
[VERSIONS OR "inspect lockfile"]

Classify the failure first into one or more of:
A. Engine / intent processing
B. Connector / transport
C. Vessel rendering or lazy loading
D. Vessel definition/state-machine validation
E. Action handler / transition
F. Layout or update synchronization

Inspection checklist:
- m.useMaelstrom(): connectionStatus, connectionError, lastError, isProcessing,
  lastResponse where relevant
- Provider onError usage
- browser connector state
- server engine logs
- current Vessel definition and active Variant
- action parameters/transitions
- relevant event telemetry
- version/package mismatch

Important:
- Do not assume processIntent() rejects; inspect Maelstrom error state.
- Do not respond to connector failures by rewriting Vessel logic unless evidence links them.
- Do not suppress schema/definition errors with casts.
- Prefer the smallest fix that restores the documented contract.

Return:
1. failure-surface classification,
2. evidence,
3. most likely root cause,
4. minimal patch,
5. validation performed,
6. alternate hypothesis if evidence is inconclusive.
```

This follows Maelstrom's documented three primary React failure surfaces and the `m.useMaelstrom()` API contract.

**Template: version-aware upgrade**

```plain
Upgrade this application from one Maelstrom build to another.

From:
[CURRENT EXACT PACKAGE VERSION(S)]

To:
[TARGET EXACT PACKAGE VERSION(S)]

Before editing:
1. Read package.json and lockfile.
2. Record every @maelstrom-co package/version.
3. Locate usages of public Maelstrom symbols.
4. Consult documentation/API reference corresponding as closely as possible to
   the target version.
5. Do not infer compatibility solely from an 'alpha' tag.

Produce an impact table:
symbol/file | current usage | target expectation | required edit | risk

Then:
- change only necessary package versions and source,
- preserve a reversible lockfile state,
- type-check,
- run tests,
- run Maelstrom-specific integration tests,
- summarize any behavior/API whose compatibility could not be verified.

Return a rollback command or commit strategy.
```

An exact-version discipline is particularly important during the current beta because Maelstrom explicitly supports alpha tags and exact preview builds while its public changelog is not yet populated with release history.