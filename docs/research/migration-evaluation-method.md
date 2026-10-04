# Migration evaluation method

This offline evaluator is separate from the
`feat/agent-skill-onboarding` documentation and SDK-guide change.

The prototype prepares matched consumers, seals an independent oracle, records
quality and token evidence, and requires external behavioral review. Its unsafe
execution flag provides no filesystem or network isolation.

The two review findings are resolved by deterministic regressions:

- The caller retains the supervisor's process group before any file publication.
  Commands inherit that group. Normal completion, timeout, supervisor SIGKILL,
  and publication failures kill and boundedly verify the retained group.
  Uncertain cleanup fails and retains status and numeric identity evidence.
  Supervisor and cleanup waits reject independently of signal success. A stalled
  supervisor therefore returns uncertainty even when helper startup or helper
  termination fails. Unreaped helper PIDs remain in the identity sidecar.
- Baseline exposure checks inspect plain system content and structured sections
  using independent sealed treatment fingerprints and skill catalog identities.
  Ordinary SDK mentions remain valid. Exposure detection does not grant receipts
  or activation to the baseline.
  Detection also checks combined startup text when a guide heading and its
  sealed prose appear in different system fields or sections.

Isolated verification passed: 276 tests under both browser preloads,
typecheck with zero errors, and Biome. The suite includes two separately bounded
counterfactual hangs, four repeated native deadlines, supervisor crashes,
publication errors, retained evidence on uncertain cleanup, and known descendant
removal. Guide examples compile against the declarations of all 14 guide-owning
packages. Required source SDK builds also passed.

Integration with the current documentation branch passed all 350 docs tests,
uncached typecheck, and Biome. The source-review findings are resolved. The
comparison still requires external behavioral approval; these deterministic
checks are not model-backed quality evidence.

The stalled-supervisor regressions returned uncertainty within their unchanged
6.5-second observation bound. They verified retained status and identities before
manually cleaning only their known groups and helper PIDs. Evidence remained
after late exits. A copy-publication fault also verifies that failed termination
cannot leave its cleanup wait pending indefinitely.

Counterfactual timeouts require the native supervisor's explicit deadline
outcome. Nonzero command exits and publication failures remain failures;
missing reports are not relabeled as timeouts. Each hang attempt restores its
consumer fixture after evaluation and checks that evaluation left it unchanged.

Historical raw traces are unavailable. Pi format support is verified with
fixtures, not new model trials. Optional terminal settlement, structured startup
sections with empty content, task/session binding, successful guide receipts,
and independent review of both sealed submissions remain required as applicable.

Keep this work separate from the documentation PR. No credential-backed model
trial, database-password change, merge, or deployment is part of this evaluator.
