---
editUrl: false
next: false
prev: false
title: "LiveSessionExchangeOptions"
---

Defined in: packages/realtime-openai-live-server/src/index.ts:9

Trusted server configuration. Never import this package into a browser.

## Properties

### apiKey

> `readonly` **apiKey**: `string`

Defined in: packages/realtime-openai-live-server/src/index.ts:11

Server-held OpenAI project key.

***

### fetch?

> `readonly` `optional` **fetch?**: \{(`input`, `init?`): `Promise`\<`Response`\>; (`input`, `init?`): `Promise`\<`Response`\>; \}

Defined in: packages/realtime-openai-live-server/src/index.ts:15

Trusted fetch implementation for server runtimes and tests. It must honor redirect rejection.

#### Call Signature

> (`input`, `init?`): `Promise`\<`Response`\>

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

##### Parameters

###### input

`URL` \| `RequestInfo`

###### init?

`RequestInit`

##### Returns

`Promise`\<`Response`\>

#### Call Signature

> (`input`, `init?`): `Promise`\<`Response`\>

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

##### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

##### Returns

`Promise`\<`Response`\>

***

### timeoutMs?

> `readonly` `optional` **timeoutMs?**: `number`

Defined in: packages/realtime-openai-live-server/src/index.ts:13

Upper bound for exchange including body reading; defaults to thirty seconds.
