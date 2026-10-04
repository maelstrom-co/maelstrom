# Migration evaluator draft

This local prototype is not ready to merge. It is separate from the
`feat/agent-skill-onboarding` documentation and SDK-guide change.

The prototype prepares matched consumers, seals an independent oracle, records
quality and token evidence, and requires external behavioral review. Its unsafe
execution flag provides no filesystem or network isolation.

Two review findings remain open:

- An abnormal supervisor exit or ledger-publication failure must terminate and
  boundedly verify every retained child/process group before deleting evidence.
- Plain system-message guide exposure must invalidate a baseline comparison,
  using the same sealed fingerprints as structured startup evidence.

Partial fixes are preserved in the isolated evaluator clone. Their latest
counterfactual-hang test reports a tool failure rather than a timeout, so they
are not integrated here. Earlier passing gates do not resolve these findings.

Continue this work separately with focused failure regressions, full uncached
checks, and a new review. No credential-backed model trial, database-password
change, publication, or deployment is authorized by this draft.
