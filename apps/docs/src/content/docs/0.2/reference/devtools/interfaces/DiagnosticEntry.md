---
editUrl: false
next: false
prev: false
title: "DiagnosticEntry"
---

Defined in: packages/devtools/src/voice-diagnostics.ts:44

Metadata-only voice or Engine observation.

## Properties

### at

> `readonly` **at**: `number`

Defined in: packages/devtools/src/voice-diagnostics.ts:50

Browser observation time.

***

### durationMs?

> `readonly` `optional` **durationMs?**: `number`

Defined in: packages/devtools/src/voice-diagnostics.ts:67

Producer-reported local duration.

***

### generation?

> `readonly` `optional` **generation?**: `number`

Defined in: packages/devtools/src/voice-diagnostics.ts:69

Connection generation when observed.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: packages/devtools/src/voice-diagnostics.ts:61

Opaque tool or request correlation.

***

### kind

> `readonly` **kind**: `"tool_call"` \| `"tool_result"` \| `"engine_started"` \| `"engine_completed"` \| `"engine_error"` \| `"voice_error"` \| `"voice_state"`

Defined in: packages/devtools/src/voice-diagnostics.ts:52

Metadata event category.

***

### ok?

> `readonly` `optional` **ok?**: `boolean`

Defined in: packages/devtools/src/voice-diagnostics.ts:65

Observed tool outcome.

***

### provider?

> `readonly` `optional` **provider?**: `string`

Defined in: packages/devtools/src/voice-diagnostics.ts:48

Application provider label.

***

### providerInstanceId?

> `readonly` `optional` **providerInstanceId?**: `string`

Defined in: packages/devtools/src/voice-diagnostics.ts:46

Unique provider lifetime identity.

***

### state?

> `readonly` `optional` **state?**: `"disconnected"` \| `"connecting"` \| `"connected"` \| `"disconnecting"` \| `"error"` \| `"idle"` \| `"listening"` \| `"thinking"` \| `"speaking"`

Defined in: packages/devtools/src/voice-diagnostics.ts:71

Observed voice state.

***

### status?

> `readonly` `optional` **status?**: `number`

Defined in: packages/devtools/src/voice-diagnostics.ts:82

Reported HTTP status, when present.

***

### tool?

> `readonly` `optional` **tool?**: `"update_ui"` \| `"get_ui_state"` \| `"get_capabilities"`

Defined in: packages/devtools/src/voice-diagnostics.ts:63

Recognized Maelstrom tool name.
