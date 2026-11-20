---
editUrl: false
next: false
prev: false
title: "SPEAK_UTTERANCE_ID_ATTR"
---

> `const` **SPEAK\_UTTERANCE\_ID\_ATTR**: `"mae-utterance-id"` = `'mae-utterance-id'`

Defined in: packages/realtime-protocol/src/lib/livekit-wire.ts:41

Attribute key carrying the utterance id on a `SPEAK_TOPIC` text stream. The
client (which initiates each utterance) stamps a monotonic id here; the worker
echoes it on the matching `TTS_TOPIC` status packet ([TtsDoneMessage](/reference/realtime-protocol/packages/realtime-protocol/src/livekit/interfaces/ttsdonemessage/) /
[TtsErrorMessage](/reference/realtime-protocol/packages/realtime-protocol/src/livekit/interfaces/ttserrormessage/)) so the client can drop status for an utterance it has
already barged past — a cancelled utterance's late `tts_done` must not clear
the client's thinking fallback or move state, or the UI wedges in `thinking`.
