---
editUrl: false
next: false
prev: false
title: "ValidatedCandidate"
---

> **ValidatedCandidate** = `MaelstromResponse` & `object`

Defined in: packages/engine/src/lib/planner/candidate.ts:108

Candidate after the Engine healed and validated it against the original
request: the response that would ship, plus the diagnostics describing what
healing changed. The diagnostics never cross the Engine boundary.

## Type Declaration

### diagnostics

> `readonly` **diagnostics**: [`EngineDiagnostics`](/reference/engine/interfaces/enginediagnostics/)

What healing changed, and whether a retry is recommended.
