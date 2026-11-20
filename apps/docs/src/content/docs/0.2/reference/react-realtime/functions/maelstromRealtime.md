---
editUrl: false
next: false
prev: false
title: "maelstromRealtime"
---

## Call Signature

> **maelstromRealtime**\<`Provider`\>(`options`): `RealtimeExtension`\<`Provider`\>

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:365

Creates one React extension that adds a shared realtime session, `useVoice`,
`useVoiceObservations`, and `VoiceOrb`. Both hooks retain the same session
per Orchestrator until the last consumer unmounts. Reading or subscribing
through `useVoiceObservations` does not connect the provider.
Provider adapters own turn detection and publish their mode
through `RealtimeSession`; this layer only reflects retained session state.

Configure [MaelstromRealtimeFixedOpeningOptions.greeting](/reference/react-realtime/interfaces/maelstromrealtimefixedopeningoptions/#greeting) when each
voice session should present a fixed assistant line. The greeting text is
exact, spoken at most once per voice session, and acknowledged into Engine
history before any speech starts so retries cannot invent a second greeting
for the same session.

To switch providers at runtime, list them in `providers`, build the adapter
from `context.provider`, choose the opening per provider with `opening`,
and call `switchProvider` from `useVoice()`. The extension is the only
place that builds sessions; attach app wiring through `onSession`.

### Type Parameters

#### Provider

`Provider` *extends* `string` \| `undefined` = `undefined`

### Parameters

#### options

[`MaelstromRealtimeOptions`](/reference/react-realtime/type-aliases/maelstromrealtimeoptions/)\<`NoInfer`\<`Provider`\>\> & `object`

### Returns

`RealtimeExtension`\<`Provider`\>

### Examples

```ts
const realtime = maelstromRealtime({
  createAdapter: () =>
    new OpenAIAdapter({
      mintToken: mintOpenAIToken,
    }),
  greeting: {
    text: 'Hello! How can I help?',
  },
});
```

```ts
const realtime = maelstromRealtime({
  providers: ['live', 'realtime'],
  createAdapter: ({ provider }) =>
    provider === 'live' ? createLiveAdapter() : createRealtimeAdapter(),
  opening: ({ provider }) =>
    provider === 'live'
      ? { generatedOpening: { instructions: 'In English, introduce yourself.' } }
      : { greeting: { text: 'Hello! How can I help?' } },
});
// In a component:
const { provider, switching, switchProvider } = realtime.useVoice();
```

## Call Signature

> **maelstromRealtime**\<`Provider`\>(`options`): `RealtimeExtension`\<`Provider`\>

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:373

Infers a single provider from its initial selection when no provider list is supplied.

### Type Parameters

#### Provider

`Provider` *extends* `string` \| `undefined` = `undefined`

### Parameters

#### options

[`MaelstromRealtimeOptions`](/reference/react-realtime/type-aliases/maelstromrealtimeoptions/)\<`Provider`\> & `object`

### Returns

`RealtimeExtension`\<`Provider`\>
