# Testing prompt checklist

Use with `maelstrom-testing` and a disposable fixture with legacy behavior, a
Maelstrom implementation, and a deterministic test connector.

- [ ] Derives the parity contract from actual fixture code/tests; does not invent product behavior.
- [ ] Separates Vessel/action, rendering/app-boundary, deterministic layout/update, intent-driven, and legacy coverage where relevant.
- [ ] Programmatic layout is used only for deterministic layout assertions and uses test-created Instance IDs.
- [ ] Reports existing tests run, newly added tests, proposed scenarios not run, and live service checks distinctly.
- [ ] Does not create an automated behavioral/LLM evaluation framework or report stubbed Engine results as live behavior.
- [ ] Test-only changes stay within the authorized scope and report uncovered risks.