---
editUrl: false
next: false
prev: false
title: "CapabilitySnapshotProjection"
---

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:185

What [readCapabilitySnapshot](/reference/client/functions/readcapabilitysnapshot/) returns: the catalog itself plus the
developer-facing record of everything the projection had to leave out.

The two travel together because the projection is pure — it reports its
own lossiness rather than logging it, leaving the caller to decide how
loudly to surface it (`Orchestrator.getCapabilitySnapshot()` warns once,
then debugs).

## Properties

### optionOmissions

> `readonly` **optionOmissions**: readonly [`CapabilityOptionOmission`](/reference/client/interfaces/capabilityoptionomission/)[]

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:187

***

### snapshot

> `readonly` **snapshot**: [`CapabilitySnapshot`](/reference/client/interfaces/capabilitysnapshot/)

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:186
