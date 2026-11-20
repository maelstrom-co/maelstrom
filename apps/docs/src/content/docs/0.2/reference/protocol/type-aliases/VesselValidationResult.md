---
editUrl: false
next: false
prev: false
title: "VesselValidationResult"
---

> **VesselValidationResult** = \{ `valid`: `true`; `vessel`: [`Vessel`](/reference/protocol/type-aliases/vessel/); \} \| \{ `issues`: readonly [`ValidationIssue`](/reference/protocol/interfaces/validationissue/)[]; `valid`: `false`; \}

Defined in: packages/protocol/src/lib/vessel.ts:191

The result of validating a Vessel object.

Discriminated union: constructing `{ valid: true, issues: [...] }` or
`{ valid: false, issues: [] }` is a compile error. On success, the parsed
`vessel` field carries the branded `Vessel` shape so callers don't have
to re-parse to get the post-transform IDs.
