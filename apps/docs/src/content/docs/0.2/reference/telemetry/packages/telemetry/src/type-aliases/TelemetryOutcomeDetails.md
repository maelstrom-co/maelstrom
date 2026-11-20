---
editUrl: false
next: false
prev: false
title: "TelemetryOutcomeDetails"
---

> **TelemetryOutcomeDetails** = \{ `errorCategory?`: [`TelemetryErrorCategory`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryerrorcategory/); `outcome`: `"failed"` \| `"skipped"` \| `"unknown"`; \} \| \{ `errorCategory?`: `never`; `outcome`: `Exclude`\<[`TelemetryOutcome`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryoutcome/), `"failed"` \| `"skipped"` \| `"unknown"`\>; \}

Defined in: packages/telemetry/src/types.ts:22

Outcome evidence with categories only where failure or unavailable work can explain it.

## Union Members

### Type Literal

\{ `errorCategory?`: [`TelemetryErrorCategory`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryerrorcategory/); `outcome`: `"failed"` \| `"skipped"` \| `"unknown"`; \}

#### errorCategory?

> `readonly` `optional` **errorCategory?**: [`TelemetryErrorCategory`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryerrorcategory/)

Classified cause; unknown denotes an unclassified cause, while omission supplies no classification.

#### outcome

> `readonly` **outcome**: `"failed"` \| `"skipped"` \| `"unknown"`

A known failure, skipped work, or insufficient outcome evidence.

***

### Type Literal

\{ `errorCategory?`: `never`; `outcome`: `Exclude`\<[`TelemetryOutcome`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryoutcome/), `"failed"` \| `"skipped"` \| `"unknown"`\>; \}

#### errorCategory?

> `readonly` `optional` **errorCategory?**: `never`

Error categories are unavailable for this outcome.

#### outcome

> `readonly` **outcome**: `Exclude`\<[`TelemetryOutcome`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryoutcome/), `"failed"` \| `"skipped"` \| `"unknown"`\>

A phase or result with no failure classification.
