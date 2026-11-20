---
editUrl: false
next: false
prev: false
title: "VesselCapability"
---

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:128

Conversational catalog entry for one registered vessel: its purpose, the
variants it can be shown in, and the actions that can transform it.
Deliberately excludes size constraints and props — this answers "what can
be shown and which values an action accepts", not "how to plan a layout".

## Properties

### actions

> `readonly` **actions**: readonly [`VesselCapabilityAction`](/reference/client/interfaces/vesselcapabilityaction/)[]

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:132

***

### description

> `readonly` **description**: `string`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:130

***

### variants

> `readonly` **variants**: readonly [`VesselCapabilityVariant`](/reference/client/interfaces/vesselcapabilityvariant/)[]

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:131

***

### vesselId

> `readonly` **vesselId**: `VesselId`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:129
