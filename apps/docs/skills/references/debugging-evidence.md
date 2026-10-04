# Debugging by observed failure surface

Classify from observations before naming a cause. Inspect relevant connection status/error and attempt history, request processing state/results, server evidence, Vessel loading/rendering, definition validation, Action handler outcomes, layout, and update conflicts as applicable. Redact logs before sharing. Identify which evidence distinguishes competing explanations.

Do not assume `processIntent()` rejects for processing failures; inspect the actual SDK state/result and the provider's error surface. A browser connection failure is not proof of a Vessel bug, and a rendered Chart is not proof that an Engine request succeeded. Record package versions and compare behavior to installed source/types/tests. If evidence is inconclusive, state the missing observation and alternatives.

Make the smallest authorized correction and add a deterministic regression test where possible. Label stubs as local evidence; do not claim live Engine/provider checks without actually running them.
