# Action effects, retries, and idempotence

An Action represents a legal operation available in the active Variant. Derive it from an existing app operation or explicit product request; keep parameters narrow and validation/effects in app-owned handlers. A transition should describe a real resulting UI state.

Classify side effects and duplicate/retry risk before declaring idempotence. Pure navigation or setting an already-selected value may be idempotent; payments, deletes, submissions, appends, increments, and other accumulating effects are not automatically safe to repeat. Mark an Action idempotent only when the underlying operation and implementation establish that guarantee. Keep confirmation and authorization policy in the application.

When editing a definition, inspect live Instances and in-flight updates that may reference removed Variants or Actions. Test success, failure, and duplicate behavior deterministically where applicable. Verify Action definition and handler APIs against installed package evidence; do not infer API behavior from this reference.
