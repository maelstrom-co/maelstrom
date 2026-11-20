---
editUrl: false
next: false
prev: false
title: "ValidateCandidate"
---

> **ValidateCandidate** = `ValidateCandidateSignatures`\[`"validate"`\]

Defined in: packages/engine/src/lib/planner/stage.ts:74

Heals and validates a candidate against the original request, the same way
the Engine validates the candidate it ships. Results are cached per
candidate object for the request, so validating inside a stage costs
nothing extra when the same candidate reaches the Engine. A failure that
healing cannot absorb (for example a missing `userMessage` on a request
without `skipReply: true`) is an `Err`; nothing throws.

Because results are cached by object identity, a candidate must not change
once it is validated: a stage that produces a different plan returns a new
object. [PlannerCandidate](/reference/engine/type-aliases/plannercandidate/) is deeply readonly to enforce this.

A [PlannerCandidate](/reference/engine/type-aliases/plannercandidate/) validates to a [ValidatedCandidate](/reference/engine/type-aliases/validatedcandidate/); a
[ReplylessCandidate](/reference/engine/type-aliases/replylesscandidate/) to a [ValidatedReplylessCandidate](/reference/engine/type-aliases/validatedreplylesscandidate/), whose
`userMessage` may be absent. A needs-clarification result is not a
candidate and is not accepted here.
