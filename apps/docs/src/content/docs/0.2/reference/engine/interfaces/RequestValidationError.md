---
editUrl: false
next: false
prev: false
title: "RequestValidationError"
---

Defined in: packages/engine/src/lib/errors.ts:154

Raised when an EngineMessage fails wire-format validation at the entry to
`engine.handle`. Distinct from [ValidationError](/reference/engine/interfaces/validationerror/) (engine-internal
validation, e.g. prompt-build throws or history-not-configured guards):
a `RequestValidationError` always means the *caller* sent malformed
input and should fix it client-side.

`layer` and `path` are both derived from the first envelope-touching issue,
falling back to the first issue overall. Cross-field invariant: when
`layer === 'envelope'`, `path` is either `[]` (root-level failure) or
`path[0]` is one of the envelope discriminator/header keys (`sessionId` |
`id` | `timestamp` | `type`). The type does not encode this — prefer the
[requestValidationError](/reference/engine/functions/requestvalidationerror/) constructor over hand-built object literals
to keep the invariant intact.

`layer` distinguishes envelope-level failures (`sessionId` / `id` /
`timestamp` / `type` discriminator) from inner-payload failures
(`request.*` body for chart_request, `content` for assistant_message).

`path` is the structured access path to the offending field, with array
indices preserved as numbers (e.g. `['request', 'instances', 2, 'vesselId']`
— index `2` is a `number`, not the string `'2'`). Use this for programmatic
consumers (alerting, grouping, UI navigation). For human-readable logs,
join with `'.'`; be aware that joining conflates a numeric-index segment
with a string key literally named `'0'`. An empty array means a root-level
failure — typically a non-object envelope, but also the defensive fallback
when an empty `issues` list is passed in. Symbol segments (only reachable
from programmatic callers passing `superRefine`-emitted issues) are coerced
via `Symbol.prototype.toString()`; wire-ingress paths never contain symbols.

`message` is derived from `layer` and `path` at construction; do not
synthesize independently.

`issues` carries the structured ZodIssue list for full diagnostic detail.

## Properties

### \_tag

> `readonly` **\_tag**: `"RequestValidationError"`

Defined in: packages/engine/src/lib/errors.ts:155

***

### issues

> `readonly` **issues**: readonly `$ZodIssue`[]

Defined in: packages/engine/src/lib/errors.ts:159

***

### layer

> `readonly` **layer**: `"envelope"` \| `"payload"`

Defined in: packages/engine/src/lib/errors.ts:157

***

### message

> `readonly` **message**: `string`

Defined in: packages/engine/src/lib/errors.ts:156

***

### path

> `readonly` **path**: readonly (`string` \| `number`)[]

Defined in: packages/engine/src/lib/errors.ts:158

***

### stack?

> `readonly` `optional` **stack?**: `string`

Defined in: packages/engine/src/lib/errors.ts:160
