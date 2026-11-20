---
editUrl: false
next: false
prev: false
title: "OperationalMetadata"
---

> **OperationalMetadata** = `object`

Defined in: packages/telemetry/src/operational-metadata.ts:21

Built-in producer metadata. Additional diagnostic scalars never become export dimensions.

## Properties

### client.action.completed

> `readonly` **client.action.completed**: `Scalars` & `Timed` & [`OperationalOutcome`](/reference/telemetry/packages/telemetry/src/integration/type-aliases/operationaloutcome/)

Defined in: packages/telemetry/src/operational-metadata.ts:40

One completed Action.

***

### client.request.failed

> `readonly` **client.request.failed**: `Scalars` & `Timed` & [`OperationalOutcome`](/reference/telemetry/packages/telemetry/src/integration/type-aliases/operationaloutcome/)

Defined in: packages/telemetry/src/operational-metadata.ts:28

Request termination before response application.

***

### client.request.started

> `readonly` **client.request.started**: `Scalars`

Defined in: packages/telemetry/src/operational-metadata.ts:23

A locally initiated client request.

***

### client.response.applied

> `readonly` **client.response.applied**: `Scalars` & `Timed` & `object`

Defined in: packages/telemetry/src/operational-metadata.ts:30

Application evidence may be absent when completion details are unavailable.

#### Type Declaration

##### actionFailures?

> `readonly` `optional` **actionFailures?**: `number`

##### skippedActions?

> `readonly` `optional` **skippedActions?**: `number`

***

### client.response.discarded

> `readonly` **client.response.discarded**: `Scalars`

Defined in: packages/telemetry/src/operational-metadata.ts:38

A response that cannot be applied to its original owner.

***

### client.response.failed

> `readonly` **client.response.failed**: `Scalars` & `Timed`

Defined in: packages/telemetry/src/operational-metadata.ts:36

Application failure independent of request transport.

***

### client.response.received

> `readonly` **client.response.received**: `Scalars` & `Timed` & `object`

Defined in: packages/telemetry/src/operational-metadata.ts:25

Response origin distinguishes local requests from pushed responses.

#### Type Declaration

##### source

> `readonly` **source**: `"request"` \| `"push"`

***

### engine.planner.completed

> `readonly` **engine.planner.completed**: `Scalars` & `Timed` & [`OperationalOutcome`](/reference/telemetry/packages/telemetry/src/integration/type-aliases/operationaloutcome/)

Defined in: packages/telemetry/src/operational-metadata.ts:48

Planner result independent of nested stages.

***

### engine.planner.started

> `readonly` **engine.planner.started**: `Scalars`

Defined in: packages/telemetry/src/operational-metadata.ts:46

Planner admission independent of request deduplication.

***

### engine.request.completed

> `readonly` **engine.request.completed**: `Scalars` & `Timed` & [`OperationalOutcome`](/reference/telemetry/packages/telemetry/src/integration/type-aliases/operationaloutcome/)

Defined in: packages/telemetry/src/operational-metadata.ts:44

Whole Engine request result.

***

### engine.request.started

> `readonly` **engine.request.started**: `Scalars`

Defined in: packages/telemetry/src/operational-metadata.ts:42

Whole Engine request admission.

***

### engine.stage.completed

> `readonly` **engine.stage.completed**: `Scalars` & `Timed` & [`OperationalOutcome`](/reference/telemetry/packages/telemetry/src/integration/type-aliases/operationaloutcome/) & `object`

Defined in: packages/telemetry/src/operational-metadata.ts:52

Nested stage result.

#### Type Declaration

##### stage

> `readonly` **stage**: `string`

***

### engine.stage.failed

> `readonly` **engine.stage.failed**: `Scalars` & `Timed` & [`OperationalOutcome`](/reference/telemetry/packages/telemetry/src/integration/type-aliases/operationaloutcome/) & `object`

Defined in: packages/telemetry/src/operational-metadata.ts:56

Unexpected stage termination.

#### Type Declaration

##### stage

> `readonly` **stage**: `string`

***

### engine.stage.started

> `readonly` **engine.stage.started**: `Scalars` & `object`

Defined in: packages/telemetry/src/operational-metadata.ts:50

Nested stage admission. Its diagnostic name is never a metric label.

#### Type Declaration

##### stage

> `readonly` **stage**: `string`

***

### voice.telemetry.dropped

> `readonly` **voice.telemetry.dropped**: `Scalars`

Defined in: packages/telemetry/src/operational-metadata.ts:70

Loss of an observation before export.

***

### voice.tool.called

> `readonly` **voice.tool.called**: `Scalars`

Defined in: packages/telemetry/src/operational-metadata.ts:60

Voice tool admission within its producer lifetime.

***

### voice.tool.cancelled

> `readonly` **voice.tool.cancelled**: `Scalars` & `object`

Defined in: packages/telemetry/src/operational-metadata.ts:68

Voice cancellation independent of result delivery.

#### Type Declaration

##### outcome

> `readonly` **outcome**: `"cancelled"`

***

### voice.tool.result

> `readonly` **voice.tool.result**: `Scalars` & `Timed` & `object` & [`OperationalOutcome`](/reference/telemetry/packages/telemetry/src/integration/type-aliases/operationaloutcome/) \| \{ `errorCategory?`: `never`; `outcome?`: `never`; \}

Defined in: packages/telemetry/src/operational-metadata.ts:62

Voice result; missing outcome evidence stays unknown during projection.

#### Type Declaration

##### ok

> `readonly` **ok**: `boolean`
