---
editUrl: false
next: false
prev: false
title: "resolveBrowserVadConfig"
---

> **resolveBrowserVadConfig**(`vad`): [`ResolvedBrowserVadConfig`](/reference/realtime-vad/packages/realtime-vad/src/type-aliases/resolvedbrowservadconfig/)

Defined in: packages/realtime-vad/src/browser-vad-config.ts:57

Resolves adapter-owned VAD configuration before initialization. Runtime
values outside `undefined | true | false | BrowserVadOptions`, unsafe
asset URLs, and unsupported or malformed provider tuning throw `TypeError`;
the adapter converts that setup error into diagnostic manual degradation.

## Parameters

### vad

`unknown`

## Returns

[`ResolvedBrowserVadConfig`](/reference/realtime-vad/packages/realtime-vad/src/type-aliases/resolvedbrowservadconfig/)
