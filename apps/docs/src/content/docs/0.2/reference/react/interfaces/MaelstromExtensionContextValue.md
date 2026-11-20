---
editUrl: false
next: false
prev: false
title: "MaelstromExtensionContextValue"
---

Defined in: packages/react/src/lib/extension-types.ts:13

Stable shape passed to extensions when they read context from inside a
Provider tree. Deliberately narrower than the internal context value
so extension authors do not couple to private bookkeeping (component
registry, vessel entries, mount guards) that may be reshaped between
minor versions.

## Properties

### config

> **config**: `ResolvedMaelstromConfig`

Defined in: packages/react/src/lib/extension-types.ts:16

***

### connector

> **connector**: `EngineConnector`

Defined in: packages/react/src/lib/extension-types.ts:15

***

### onErrorRef

> **onErrorRef**: `MutableRefObject`\<((`error`) => `void`) \| `undefined`\>

Defined in: packages/react/src/lib/extension-types.ts:18

Ref to onError callback from Provider props. Lets extensions surface errors without re-renders.

***

### orchestrator

> **orchestrator**: `Orchestrator`

Defined in: packages/react/src/lib/extension-types.ts:14
