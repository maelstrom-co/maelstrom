---
editUrl: false
next: false
prev: false
title: "CapabilitySnapshot"
---

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:141

The full capability catalog: every registered vessel's purpose, variants,
and actions. Source of truth for the `get_capabilities` voice tool —
answers "what can you show me?" the way [UIStructuralSnapshot](/reference/client/interfaces/uistructuralsnapshot/)
answers "what's on screen right now?".

## Properties

### vessels

> `readonly` **vessels**: readonly [`VesselCapability`](/reference/client/interfaces/vesselcapability/)[]

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:142
