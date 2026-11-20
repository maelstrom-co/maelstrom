---
editUrl: false
next: false
prev: false
title: "OpenAILiveAdapterOptions"
---

Defined in: packages/realtime-openai-live/src/live-adapter.ts:35

Managed tool integration settings. Transport factories and exchange remain host-owned.

## Extends

- [`LiveTransportOptions`](/reference/realtime-openai-live/interfaces/livetransportoptions/)

## Properties

### batchTimeoutMs?

> `readonly` `optional` **batchTimeoutMs?**: `number`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:47

Bound for one backend batch, including application results, default 120 seconds. Timeout ends voice; submitted UI work continues.

***

### closeTimeoutMs?

> `readonly` `optional` **closeTimeoutMs?**: `number`

Defined in: packages/realtime-openai-live/src/live-transport.ts:38

Final-event drain bound after disconnect; default 15 seconds.

#### Inherited from

[`LiveTransportOptions`](/reference/realtime-openai-live/interfaces/livetransportoptions/).[`closeTimeoutMs`](/reference/realtime-openai-live/interfaces/livetransportoptions/#closetimeoutms)

***

### contextTimeoutMs?

> `readonly` `optional` **contextTimeoutMs?**: `number`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:49

Bound for each opening, recovery, or grounding acknowledgment, default 30 seconds. Expiry reports unknown delivery, never speech completion.

***

### createAudio?

> `readonly` `optional` **createAudio?**: () => `HTMLAudioElement`

Defined in: packages/realtime-openai-live/src/live-transport.ts:44

Owned audio player factory; playback can be retried through activateAudio.

#### Returns

`HTMLAudioElement`

#### Inherited from

[`LiveTransportOptions`](/reference/realtime-openai-live/interfaces/livetransportoptions/).[`createAudio`](/reference/realtime-openai-live/interfaces/livetransportoptions/#createaudio)

***

### createPeer?

> `readonly` `optional` **createPeer?**: () => `RTCPeerConnection`

Defined in: packages/realtime-openai-live/src/live-transport.ts:40

Trusted peer factory, useful for RTC configuration and isolated browser tests.

#### Returns

`RTCPeerConnection`

#### Inherited from

[`LiveTransportOptions`](/reference/realtime-openai-live/interfaces/livetransportoptions/).[`createPeer`](/reference/realtime-openai-live/interfaces/livetransportoptions/#createpeer)

***

### exchange

> `readonly` **exchange**: `LiveSessionExchange`

Defined in: packages/realtime-openai-live/src/live-transport.ts:34

Host-owned SDP exchange, usually an authenticated application route.

#### Inherited from

[`LiveTransportOptions`](/reference/realtime-openai-live/interfaces/livetransportoptions/).[`exchange`](/reference/realtime-openai-live/interfaces/livetransportoptions/#exchange)

***

### getMicrophone?

> `readonly` `optional` **getMicrophone?**: () => `Promise`\<`MediaStream`\>

Defined in: packages/realtime-openai-live/src/live-transport.ts:42

Owned microphone acquisition, invoked synchronously by connect in the user gesture.

#### Returns

`Promise`\<`MediaStream`\>

#### Inherited from

[`LiveTransportOptions`](/reference/realtime-openai-live/interfaces/livetransportoptions/).[`getMicrophone`](/reference/realtime-openai-live/interfaces/livetransportoptions/#getmicrophone)

***

### handshakeTimeoutMs?

> `readonly` `optional` **handshakeTimeoutMs?**: `number`

Defined in: packages/realtime-openai-live/src/live-transport.ts:36

Total startup bound including permission, ICE, HTTP, answer, and session.started; default 45 seconds.

#### Inherited from

[`LiveTransportOptions`](/reference/realtime-openai-live/interfaces/livetransportoptions/).[`handshakeTimeoutMs`](/reference/realtime-openai-live/interfaces/livetransportoptions/#handshaketimeoutms)

***

### maxCalls?

> `readonly` `optional` **maxCalls?**: `number`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:45

Maximum retained function identities per connection, default 1024. Exhaustion ends voice without replaying work.

***

### maxResponses?

> `readonly` `optional` **maxResponses?**: `number`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:43

Maximum retained responses per connection, default 256. Exhaustion ends voice rather than evicting replay protection.

***

### model

> `readonly` **model**: `string`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:37

Voice model selected at startup.

***

### playbackBargeIn?

> `readonly` `optional` **playbackBargeIn?**: `boolean` \| `BrowserVadOptions`

Defined in: packages/realtime-openai-live/src/live-transport.ts:52

Experimental local playback gating, default off. Uses the existing mic;
speech onset disables received audio tracks, not provider generation.
Speech end plus 200ms of incoming quiet restores exact prior track values;
misfires restore immediately. A reply with no quiet gap can be clipped.
Unavailable detection falls back to provider-only behavior. preRollMs is unused.

#### Inherited from

[`LiveTransportOptions`](/reference/realtime-openai-live/interfaces/livetransportoptions/).[`playbackBargeIn`](/reference/realtime-openai-live/interfaces/livetransportoptions/#playbackbargein)

***

### responses

> `readonly` **responses**: `Omit`\<`LiveResponsesConfig`, `"instructions"` \| `"tools"`\>

Defined in: packages/realtime-openai-live/src/live-adapter.ts:39

Backend model and supported generation settings. The session supplies instructions and tools.

***

### voice?

> `readonly` `optional` **voice?**: `string`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:41

Voice selected before media starts; omission uses the provider default.
