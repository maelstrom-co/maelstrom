---
editUrl: false
next: false
prev: false
title: "LiveTransportOptions"
---

Defined in: packages/realtime-openai-live/src/live-transport.ts:32

Browser transport configuration. Factories must return exclusively owned resources.

## Extended by

- [`OpenAILiveAdapterOptions`](/reference/realtime-openai-live/interfaces/openailiveadapteroptions/)

## Properties

### closeTimeoutMs?

> `readonly` `optional` **closeTimeoutMs?**: `number`

Defined in: packages/realtime-openai-live/src/live-transport.ts:38

Final-event drain bound after disconnect; default 15 seconds.

***

### createAudio?

> `readonly` `optional` **createAudio?**: () => `HTMLAudioElement`

Defined in: packages/realtime-openai-live/src/live-transport.ts:44

Owned audio player factory; playback can be retried through activateAudio.

#### Returns

`HTMLAudioElement`

***

### createPeer?

> `readonly` `optional` **createPeer?**: () => `RTCPeerConnection`

Defined in: packages/realtime-openai-live/src/live-transport.ts:40

Trusted peer factory, useful for RTC configuration and isolated browser tests.

#### Returns

`RTCPeerConnection`

***

### exchange

> `readonly` **exchange**: `LiveSessionExchange`

Defined in: packages/realtime-openai-live/src/live-transport.ts:34

Host-owned SDP exchange, usually an authenticated application route.

***

### getMicrophone?

> `readonly` `optional` **getMicrophone?**: () => `Promise`\<`MediaStream`\>

Defined in: packages/realtime-openai-live/src/live-transport.ts:42

Owned microphone acquisition, invoked synchronously by connect in the user gesture.

#### Returns

`Promise`\<`MediaStream`\>

***

### handshakeTimeoutMs?

> `readonly` `optional` **handshakeTimeoutMs?**: `number`

Defined in: packages/realtime-openai-live/src/live-transport.ts:36

Total startup bound including permission, ICE, HTTP, answer, and session.started; default 45 seconds.

***

### playbackBargeIn?

> `readonly` `optional` **playbackBargeIn?**: `boolean` \| `BrowserVadOptions`

Defined in: packages/realtime-openai-live/src/live-transport.ts:52

Experimental local playback gating, default off. Uses the existing mic;
speech onset disables received audio tracks, not provider generation.
Speech end plus 200ms of incoming quiet restores exact prior track values;
misfires restore immediately. A reply with no quiet gap can be clipped.
Unavailable detection falls back to provider-only behavior. preRollMs is unused.
