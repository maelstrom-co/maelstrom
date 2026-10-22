# Domain documentation

Read `CONTEXT.md` and `docs/architecture.md` before changing domain concepts.
For realtime voice, also read `docs/realtime-voice-architecture.md`. These public
files contain the current vocabulary and contributor requirements.

Use the glossary's terms in code, tests, issues, and proposals. Vessel, Chart,
Engine, Variant, and Action have distinct meanings. If a needed concept is
missing, identify the gap before introducing another term.

Keep current technical requirements in the public architecture documentation.
Maintain internal decision records and research in ClickUp, following
`docs/agents/issue-tracker.md`. Contributors must be able to work from the public
documentation without access to private records. Public files must not contain
private ClickUp links.

When a proposal changes an existing requirement, name the affected architecture
section and explain the proposed change. Update the public contract and its
relevant tests together when the change is accepted.
