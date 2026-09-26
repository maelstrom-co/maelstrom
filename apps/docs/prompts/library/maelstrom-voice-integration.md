---
id: maelstrom-voice-integration
prompt_version: 1.0.0
compatibility:
  sdk:
    "@maelstrom-co/react-realtime": "0.1.0-alpha.4"
    "@maelstrom-co/realtime": "0.1.0-alpha.4"
    "@maelstrom-co/realtime-protocol": "0.1.0-alpha.4"
---

Plan or implement voice for this Maelstrom application only if the requested
product goal requires it. Voice is an optional intent input, not a second planner.

Product goal: [USER GOAL]
Provider/deployment: [OPENAI REALTIME | LIVEKIT CASCADE | OTHER | UNDECIDED]
App/auth boundary: [DETAILS OR "inspect"]
Installed Maelstrom voice versions: [KNOWN OR "inspect"]
Implementation authorized: [YES / NO]

Inspect the app's current intent flow, React shell, server routes/deployment,
installed package versions, and the canonical voice architecture before proposing
changes. Read `docs/realtime-voice-architecture.md` and ADRs 0001, 0002, and 0003.
Confirm selected APIs against the installed package exports/types and the matching
provider guide. Do not assume a provider or add voice packages until the user goal
and provider/deployment decision justify them. If a decision is missing, return
the bounded decision needed rather than choosing a provider.

Keep the responsibilities distinct:

- **Browser/React:** voice UI, microphone interaction, session presentation, and
  appropriate React binding. Voice controls are not automatically a Vessel.
- **Realtime:** provider adapter/session lifecycle and turn-taking, with provider
  differences preserved rather than hidden behind invented common behavior.
- **Server/worker:** provider keys and minters/workers only on their owning server
  side. Browser receives only the narrowly scoped short-lived credential needed
  by the selected provider. Application auth, authorization, origin policy, and
  rate limits remain app-owned; a package minter does not authenticate callers.
- **Planning:** speech becomes ordinary natural-language intent. The Engine stays
  the planner and uses client-owned Chart state. Turn mode is runtime behavior,
  not a fixed provider flag.

Honor the four-layer boundary: CONTRACT, BROWSER, SERVER, WORKER. No server or
worker package may depend on a browser package. Do not put provider secrets or
Vessel/Chart structure into a voice worker. Distinguish actual provider support
and deployment requirements in the checked-in guides from hypothetical options.

For an authorized bounded implementation, preserve unrelated application flows,
add deterministic tests for locally testable lifecycle and failure behavior, and
run affected checks. Do not claim microphone, acoustic, live provider, or Engine
success unless that exact scenario was exercised. Return a layer-separated
integration map, provider/auth decisions and unresolved questions, version/API
anchors, changed files or plan, test commands/results, security and turn-mode
risks, and unrun manual scenarios.