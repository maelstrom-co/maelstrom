# Migration evaluator draft

This local prototype awaits independent review before merge. It is separate from the
`feat/agent-skill-onboarding` documentation and SDK-guide change.

The prototype prepares matched consumers, seals an independent oracle, records
quality and token evidence, and requires external behavioral review. Its unsafe
execution flag provides no filesystem or network isolation.

The two review findings are resolved by deterministic regressions:

- The caller retains the supervisor's process group before any file publication.
  Commands inherit that group. Normal completion, timeout, supervisor SIGKILL,
  and publication failures kill and boundedly verify the retained group.
  Uncertain cleanup fails and retains status and numeric identity evidence.
- Baseline exposure checks inspect plain system content and structured sections
  using independent sealed treatment fingerprints and skill catalog identities.
  Ordinary SDK mentions remain valid. Exposure detection does not grant receipts
  or activation to the baseline.

Uncached docs verification passed: 273 tests under both browser preloads,
typecheck with zero errors, and Biome. The suite includes two separately bounded
counterfactual hangs, four repeated native deadlines, supervisor crashes,
publication errors, retained evidence on uncertain cleanup, and known descendant
removal. Guide examples compile against the declarations of all 14 guide-owning
packages. Required source SDK builds also passed.

Counterfactual timeouts require the native supervisor's explicit deadline
outcome. Nonzero command exits and publication failures remain failures;
missing reports are not relabeled as timeouts. Each hang attempt restores its
consumer fixture after evaluation and checks that evaluation left it unchanged.

Historical raw traces are unavailable. Pi format support is verified with
fixtures, not new model trials. Optional terminal settlement, structured startup
sections with empty content, task/session binding, successful guide receipts,
and independent review of both sealed submissions remain required as applicable.

Keep this work separate and obtain a new review before publication. No credential-backed model trial, database-password
change, publication, or deployment is authorized by this draft.
