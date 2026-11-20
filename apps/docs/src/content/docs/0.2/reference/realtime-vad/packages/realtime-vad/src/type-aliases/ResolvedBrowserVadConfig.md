---
editUrl: false
next: false
prev: false
title: "ResolvedBrowserVadConfig"
---

> **ResolvedBrowserVadConfig** = \{ `enabled`: `false`; \} \| \{ `assetBaseUrl`: `string`; `enabled`: `true`; `preRollMs`: `number`; `providerOptions`: [`BrowserVadProviderOptions`](/reference/realtime-vad/packages/realtime-vad/src/interfaces/browservadprovideroptions/); \}

Defined in: packages/realtime-vad/src/browser-vad-config.ts:31

The return type of [resolveBrowserVadConfig](/reference/realtime-vad/packages/realtime-vad/src/functions/resolvebrowservadconfig/): a validated VAD
configuration, narrowed by `enabled` so the disabled case carries no
settings at all.

Discriminate on `enabled` before use — `false` means the caller asked for
manual turns, and no assets should be fetched and no worklet created.

## Example

```ts
const config: ResolvedBrowserVadConfig = resolveBrowserVadConfig(input);
if (config.enabled) {
  await createBrowserVad({ stream, config, startTurn, endTurn, cancelTurn, onFailure });
}
```
