---
editUrl: false
next: false
prev: false
title: "LiveCommand"
---

> **LiveCommand** = \{ `event_id`: `string`; `type`: `"response.create"`; \} \| \{ `event_id`: `string`; `item`: \{ `call_id`: `string`; `output`: `string`; `type`: `"function_call_output"`; \}; `type`: `"response.item.create"`; \} \| \{ `content`: `string`; `delegation_id`: `null`; `event_id`: `string`; `type`: `"session.thinking.append"` \| `"session.instructions.append"` \| `"session.commentary.append"`; \}

Defined in: packages/realtime-protocol/src/openai-live.ts:232

Commands supported by the transport seam. Sending proves local submission, never provider acceptance.

## Union Members

### Type Literal

\{ `event_id`: `string`; `type`: `"response.create"`; \}

#### event\_id

> `readonly` **event\_id**: `string`

Caller correlation identity.

#### type

> `readonly` **type**: `"response.create"`

Continue the configured backend after required results are submitted.

***

### Type Literal

\{ `event_id`: `string`; `item`: \{ `call_id`: `string`; `output`: `string`; `type`: `"function_call_output"`; \}; `type`: `"response.item.create"`; \}

#### event\_id

> `readonly` **event\_id**: `string`

Caller correlation identity.

#### item

> `readonly` **item**: `object`

Completed function result.

##### item.call\_id

> `readonly` **call\_id**: `string`

Native function call identity.

##### item.output

> `readonly` **output**: `string`

Serialized application result, with truthful completion status.

##### item.type

> `readonly` **type**: `"function_call_output"`

Backend item discriminator.

#### type

> `readonly` **type**: `"response.item.create"`

Append an item without automatically continuing the backend.

***

### Type Literal

\{ `content`: `string`; `delegation_id`: `null`; `event_id`: `string`; `type`: `"session.thinking.append"` \| `"session.instructions.append"` \| `"session.commentary.append"`; \}

#### content

> `readonly` **content**: `string`

Plain text limited by the provider to 500 tokens.

#### delegation\_id

> `readonly` **delegation\_id**: `null`

Managed Responses sessions accept only session-wide appends.

#### event\_id

> `readonly` **event\_id**: `string`

Caller correlation identity for acceptance or rejection.

#### type

> `readonly` **type**: `"session.thinking.append"` \| `"session.instructions.append"` \| `"session.commentary.append"`

Whether appended context steers behavior, adds facts, or requests speech.
