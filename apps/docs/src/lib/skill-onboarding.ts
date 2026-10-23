export const skillBundleUrl =
  'https://docs.maelstrom-ai.co/agents/skills/bundle.zip';
export const skillInstaller = 'skills@1.7.0';

export const skillAgents = [
  { id: 'pi', name: 'Pi', directory: '.pi/skills/' },
  { id: 'opencode', name: 'OpenCode', directory: '.agents/skills/' },
  { id: 'claude-code', name: 'Claude Code', directory: '.claude/skills/' },
] as const;

export const firstPlanRequest =
  'Use the maelstrom skill to inspect this app and plan one bounded Maelstrom integration. Report the selected capability, installed SDK versions, verification plan, and rollback. Do not edit files or install packages.';

export const firstImplementationRequest =
  'Use the maelstrom skill to implement only the approved integration described below. Preserve application data, authorization, and the legacy path. Run the relevant typecheck, tests, and lint. Report live Engine checks separately. Approved goal: [describe the bounded capability].';

export const skillTasks = [
  {
    id: 'maelstrom-project-onboarding',
    title: 'Plan a first integration',
    outcome: 'Inspect an existing app and choose one useful pilot.',
    request: firstPlanRequest,
    evidence:
      'An observed capability, exact installed versions or their absence, and a plan with no edits.',
  },
  {
    id: 'maelstrom-vessel-modeling',
    title: 'Model a capability',
    outcome: 'Decide which user-visible capability should become a Vessel.',
    request:
      'Use the maelstrom skill to plan a Vessel for [existing capability]. Derive Variants and Actions only from observed behavior. Explain the Engine value and application ownership. Do not edit files.',
    evidence:
      'Source-backed Variants and Actions; incidental controls stay inside the capability.',
  },
  {
    id: 'maelstrom-react-migration',
    title: 'Migrate a React capability',
    outcome: 'Keep the legacy behavior while moving one bounded slice.',
    request:
      'Use the maelstrom skill to plan migrating [React capability] behind its existing route or flag. Preserve application-owned data and effects. Report parity tests and rollback. Do not edit files.',
    evidence:
      'Installed React API evidence, a reversible boundary, and parity tests to run.',
  },
  {
    id: 'maelstrom-debugging',
    title: 'Diagnose a failure',
    outcome: 'Find the failure layer from code and redacted observations.',
    request:
      'Use the maelstrom skill to diagnose [symptom] from the installed SDK, code, and redacted evidence. Separate observations from hypotheses. Do not implement a fix yet.',
    evidence:
      'A supported diagnosis or the missing observation; local checks are distinct from live Engine checks.',
  },
  {
    id: 'maelstrom-observability',
    title: 'Add observability',
    outcome: 'Select the events needed to explain one production behavior.',
    request:
      'Use the maelstrom skill to plan observability for [behavior]. Verify installed event APIs and choose bounded, redacted payloads. Do not edit files or log credentials or user content.',
    evidence:
      'Verified event names, payload boundaries, and privacy-safe verification.',
  },
  {
    id: 'maelstrom-state-sync',
    title: 'Synchronize state',
    outcome:
      'Update a Vessel definition or Instance without losing application state.',
    request:
      'Use the maelstrom skill to plan synchronizing [external change] with this Vessel. Inspect registration, live Instances, and update conflicts. Preserve application-owned state. Do not edit files.',
    evidence:
      'The supported update path, complete definition preservation, and an explicit conflict policy.',
  },
  {
    id: 'maelstrom-voice-integration',
    title: 'Plan optional voice',
    outcome: 'Add voice only when the product goal requires it.',
    request:
      'Use the maelstrom skill to plan optional voice for [intent]. Provider and deployment are undecided. Keep those choices open, inspect the bundled architecture requirements, and make no edits or installations.',
    evidence:
      'Browser/server/worker boundaries, unresolved choices, and untested microphone/provider scenarios.',
  },
  {
    id: 'maelstrom-voice-devtools',
    title: 'Benchmark voice through desktop MCP',
    outcome:
      'Benchmark, stress, and test Maelstrom with sequential repeats, harder tasks, VAD latency, and acoustic barge-in.',
    request:
      'Use the maelstrom skill to plan a Voice DevTools desktop MCP benchmark for [supported tasks]. Define easy/medium/hard conditions, exact repeated prompts, state resets, observation windows, and n/median/range reporting with failed/unmeasurable counts. Do not inject audio or edit files.',
    evidence:
      'A sequential bounded protocol, receipt-clock VAD endpoints and task checks; no concurrency flooding, small-sample p95, or causal interruption claims.',
  },
] as const;
