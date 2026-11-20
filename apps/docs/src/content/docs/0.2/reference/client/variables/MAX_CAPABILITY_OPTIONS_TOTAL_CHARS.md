---
editUrl: false
next: false
prev: false
title: "MAX_CAPABILITY_OPTIONS_TOTAL_CHARS"
---

> `const` **MAX\_CAPABILITY\_OPTIONS\_TOTAL\_CHARS**: `2000` = `2000`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:95

Maximum combined length, in characters, of a parameter's projected enum
values (see [VesselCapabilityParameter.options](/reference/client/interfaces/vesselcapabilityparameter/#options)) that may appear in
`options`. Applied independently of [MAX\_CAPABILITY\_OPTION\_COUNT](/reference/client/variables/max_capability_option_count/) — a
handful of very long values can blow the context budget well before the
count limit is reached.
