---
editUrl: false
next: false
prev: false
title: "DevtoolsOptions"
---

Defined in: packages/devtools/src/types.ts:7

Configuration shared by every framework adapter.

## Properties

### capture?

> `readonly` `optional` **capture?**: [`CaptureOptions`](/reference/devtools/interfaces/captureoptions/) \| [`DiagnosticCapture`](/reference/devtools/classes/diagnosticcapture/)

Defined in: packages/devtools/src/types.ts:23

Capture bounds/redaction, or an existing capture store for migration.

***

### enabled?

> `readonly` `optional` **enabled?**: `boolean`

Defined in: packages/devtools/src/types.ts:9

Disables collection and mounting. Defaults to true in development.

***

### filter?

> `readonly` `optional` **filter?**: (`event`) => `boolean`

Defined in: packages/devtools/src/types.ts:27

Optional event filter applied before retention.

#### Parameters

##### event

`DiagnosticEvent`

#### Returns

`boolean`

***

### initialIsOpen?

> `readonly` `optional` **initialIsOpen?**: `boolean`

Defined in: packages/devtools/src/types.ts:11

Initial panel visibility. Defaults to false.

***

### maxActivityEvents?

> `readonly` `optional` **maxActivityEvents?**: `number`

Defined in: packages/devtools/src/types.ts:17

Recent metadata events retained across clients. Defaults to 100.

***

### maxRequestEvents?

> `readonly` `optional` **maxRequestEvents?**: `number`

Defined in: packages/devtools/src/types.ts:19

Metadata events retained for request history. Evicts whole requests; a single oversized request keeps its latest events. Defaults to 1000.

***

### maxSessions?

> `readonly` `optional` **maxSessions?**: `number`

Defined in: packages/devtools/src/types.ts:21

Maximum retained client lifetimes. Defaults to 16.

***

### position?

> `readonly` `optional` **position?**: `"bottom-left"` \| `"bottom-right"` \| `"top-left"` \| `"top-right"`

Defined in: packages/devtools/src/types.ts:13

Trigger corner. Defaults to bottom-right.

***

### redact?

> `readonly` `optional` **redact?**: (`value`) => `unknown`

Defined in: packages/devtools/src/types.ts:25

Redacts all metadata, snapshots, imported files, and explicit content.

#### Parameters

##### value

`unknown`

#### Returns

`unknown`

***

### telemetry?

> `readonly` `optional` **telemetry?**: `Pick`\<`Telemetry`, `"getSnapshot"`\>

Defined in: packages/devtools/src/types.ts:34

Application-owned synchronous telemetry reader. The visible Telemetry tab reads
immediately and every second, retaining up to 120 local samples until unmount.
Reader changes, resets, failures, and pauses break rate continuity.
No exporter lifecycle or recording access is granted.

***

### theme?

> `readonly` `optional` **theme?**: `"system"` \| `"light"` \| `"dark"`

Defined in: packages/devtools/src/types.ts:15

Color scheme. Defaults to system.
