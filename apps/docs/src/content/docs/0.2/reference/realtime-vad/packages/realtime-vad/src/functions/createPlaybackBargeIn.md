---
editUrl: false
next: false
prev: false
title: "createPlaybackBargeIn"
---

> **createPlaybackBargeIn**(`options`): [`PlaybackBargeIn`](/reference/realtime-vad/packages/realtime-vad/src/interfaces/playbackbargein/)

Defined in: packages/realtime-vad/src/playback-barge-in.ts:37

Mutes received tracks on local speech onset, including tracks attached later.
Speech end alone cannot expose old output: recovery requires 200ms of observed
remote quiet after speech ends. A VAD misfire restores immediately. A private
enabled clone measures incoming audio while the playback track is disabled;
no probe audio reaches the destination. This is not provider cancellation.
Continuous old output stays muted, and a new reply without a quiet gap can be
clipped. Initialization or monitoring failure restores provider-only behavior.

## Parameters

### options

[`PlaybackBargeInOptions`](/reference/realtime-vad/packages/realtime-vad/src/interfaces/playbackbargeinoptions/)

## Returns

[`PlaybackBargeIn`](/reference/realtime-vad/packages/realtime-vad/src/interfaces/playbackbargein/)
