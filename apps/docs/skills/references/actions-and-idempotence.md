# Action effects, retries, and idempotence

An Action represents a legal operation available in the active Variant. Derive it from an existing app operation or explicit product request; keep parameters narrow and validation/effects in app-owned handlers. A transition should describe a real resulting UI state.

Classify side effects and duplicate/retry risk before choosing an Action's `effect`. Declare `effect: 'none'` only for a view switch that needs nothing from the app. It must declare `transitionsTo` and no parameters, and it needs no handler. Declare `effect: 'idempotent'` only when the underlying operation and implementation establish that repeating it is safe, for example setting an already-selected value. Leave `effect` unset, which means `'any'`, for payments, deletes, submissions, appends, increments, and other accumulating effects. Every Action not declared `'none'` needs a handler, or it is skipped and changes no Variant. Keep confirmation and authorization policy in the application.

When editing a definition, inspect live Instances and in-flight updates that may reference removed Variants or Actions. Test success, failure, and duplicate behavior deterministically where applicable. Verify Action definition and handler APIs against installed package evidence; do not infer API behavior from this reference.
