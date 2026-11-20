---
editUrl: false
next: false
prev: false
title: "MAX_CAPABILITY_OPTION_COUNT"
---

> `const` **MAX\_CAPABILITY\_OPTION\_COUNT**: `100` = `100`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:86

Maximum number of enum values a parameter may project into `options`.
Bounds how much of a voice model's context budget a single parameter's
option list can consume — a parameter whose enum exceeds this count has
its options omitted rather than truncated; see
[VesselCapabilityParameter.optionsOmitted](/reference/client/interfaces/vesselcapabilityparameter/#optionsomitted).
