---
editUrl: false
next: false
prev: false
title: "createBrowserVad"
---

> **createBrowserVad**(`options`): `Promise`\<[`BrowserVad`](/reference/realtime-vad/packages/realtime-vad/src/type-aliases/browservad/)\>

Defined in: packages/realtime-vad/src/browser-vad.ts:83

Starts one connection-bound browser VAD over the adapter's local microphone
stream. Maelstrom owns every stream and lifecycle callback passed to MicVAD.
A real speech end commits the active transport turn; a VAD misfire instead
cancels it because vad-web emits no following `onSpeechEnd` for speech shorter
than `minSpeechMs`. Adjacent duplicate boundaries collapse while alternating
rapid boundaries retain their order even though provider callbacks are not
assumed to be serialized. Load, construction, and initial start failures
reject so connect can choose manual mode. Later boundary failures fence
callbacks and offer `onFailure` the diagnostic once. When a turn is active,
the handler also receives that state and an idempotent retire operation so it
can safely close or cancel transport, retire VAD, then expose manual control in
that order. Without an active turn, VAD retires before the handler runs.
Handler rejection is swallowed only after retirement is guaranteed. Destroy
is idempotent, closes an established turn when no boundary or failure handler
owns finalization, and does not stop the shared microphone stream. Every
callback becomes a no-op after destroy/failure, including stale callbacks from
a superseded connection generation.

## Parameters

### options

[`CreateBrowserVadOptions`](/reference/realtime-vad/packages/realtime-vad/src/type-aliases/createbrowservadoptions/)

## Returns

`Promise`\<[`BrowserVad`](/reference/realtime-vad/packages/realtime-vad/src/type-aliases/browservad/)\>
