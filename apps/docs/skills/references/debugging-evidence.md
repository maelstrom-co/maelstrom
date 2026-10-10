# Debugging by observed failure surface

Classify from observations before naming a cause. Inspect relevant connection status/error and attempt history, request processing state/results, server evidence, Vessel loading/rendering, definition validation, Action handler outcomes, layout, and update conflicts as applicable. Redact logs before sharing. Identify which evidence distinguishes competing explanations.

Do not assume `processIntent()` rejects for processing failures; inspect the actual SDK state/result and the provider's error surface. A browser connection failure is not proof of a Vessel bug, and a rendered Chart is not proof that an Engine request succeeded. Record package versions and compare behavior to installed source/types/tests. If evidence is inconclusive, state the missing observation and alternatives.

Make the smallest authorized correction and add a deterministic regression test where possible. Label stubs as local evidence; do not claim live Engine/provider checks without actually running them.

## Collect evidence with DevTools

If DevTools is installed, inspect its existing metadata before adding diagnostic
listeners. Read the owning installed manifest and its package guide:
`@maelstrom-co/react-devtools` for React wiring, or `@maelstrom-co/devtools` for
the framework-independent collector. Use the package-owned
`skills/maelstrom-<package>-sdk/SKILL.md`; verify exports directly if that guide
is absent. The [DevTools guide](https://docs.maelstrom-ai.co/guides/devtools/)
explains the interface; installed package evidence governs version-specific APIs.

Use Requests to distinguish response receipt, client application, and Action
outcomes. Identify a request by app lifetime and request ID. Use Inspector for
recorded structure and Connections for Engine and optional voice evidence.
Find voice metadata through All events with a `voice.` search. Missing server
stages can mean forwarding is unavailable; they do not establish Engine failure.

Content recording needs authorization that covers retaining application data.
Choose a recording scope, start before reproduction, then stop and inspect it.
Inspection filters do not change recording scope. Earlier content cannot be
recovered. Imported recordings are read-only evidence and never replay work.
Inspect and redact exports before sharing; built-in redaction cannot identify
all sensitive application data. Share only the evidence needed for the diagnosis.

If the integration lacks DevTools, use existing state and logs. Installation or
integration changes need task authorization. A diagnose-only task does not
authorize installing packages, enabling production tools, or changing server
forwarding. Default production entrypoints are inert; browser opt-in does not
enable production Engine forwarding. DevTools supports local inspection and
explicit recordings; use the application's telemetry system for operational reporting.
