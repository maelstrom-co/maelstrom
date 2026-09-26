# State synchronization prompt checklist

Use with `maelstrom-state-sync` and a disposable project containing a factory-known
Vessel and/or runtime-registered Vessel with a controlled update/conflict scenario.

- [ ] Identifies app ownership of data and client ownership of layout from inspected code.
- [ ] Distinguishes Instance state/layout changes from definition republishing and cites the installed update API.
- [ ] Selects the correct factory or runtime-registration path and handles relevant conflicts/in-flight updates explicitly.
- [ ] Preserves atomic response order: `set_layout` before `execute_actions`; no inline resize reconciliation is proposed.
- [ ] Deterministic tests use real test-created Instance IDs and do not claim live Engine verification.
- [ ] Unknown conflict policy is left as a question rather than silently forcing or discarding updates.