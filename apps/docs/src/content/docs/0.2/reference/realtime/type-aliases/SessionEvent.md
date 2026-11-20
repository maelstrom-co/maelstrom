---
editUrl: false
next: false
prev: false
title: "SessionEvent"
---

> **SessionEvent** = [`SessionLifecycleEvent`](/reference/realtime/type-aliases/sessionlifecycleevent/) \| [`TranscriptFragmentEvent`](/reference/realtime/interfaces/transcriptfragmentevent/) \| [`TranscriptEntryEvent`](/reference/realtime/interfaces/transcriptentryevent/) \| [`MediaEvent`](/reference/realtime/interfaces/mediaevent/) \| [`ToolCallEvent`](/reference/realtime/type-aliases/toolcallevent/) \| [`ToolOutcomeEvent`](/reference/realtime/type-aliases/tooloutcomeevent/) \| [`TimingEvent`](/reference/realtime/interfaces/timingevent/) \| [`OpeningClaimedEvent`](/reference/realtime/interfaces/openingclaimedevent/)

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:20

A fact one `RealtimeSession` learned or caused, in the past tense or as an
observation. The union has no request variants, so the bus cannot carry a
command. Requests that need an answer stay on their own request and
response paths: `tool.called` only reports that a call arrived, and the
answer still goes back to the provider directly. Work status is not an
event: it is a level owned by the Orchestrator and read through its own
source.

The union is additive: later versions may add variants, so a subscriber
must ignore types it does not handle.
