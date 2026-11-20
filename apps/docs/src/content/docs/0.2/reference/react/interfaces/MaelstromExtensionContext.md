---
editUrl: false
next: false
prev: false
title: "MaelstromExtensionContext"
---

Defined in: packages/react/src/lib/extension-types.ts:27

Context handle handed to a `MaelstromExtension`. Exposes a hook that,
when called inside the matching Provider tree, returns the stable
extension-context subset. The actual runtime object carries more
fields, but only those listed here are part of the supported contract.

## Properties

### onOrchestrator?

> `optional` **onOrchestrator?**: (`attach`) => () => `void`

Defined in: packages/react/src/lib/extension-types.ts:29

Observes this extension branch and its descendants before Provider connection; returns registration cleanup.

#### Parameters

##### attach

(`orchestrator`) => () => `void`

#### Returns

() => `void`

***

### useMaelstromContext

> **useMaelstromContext**: () => [`MaelstromExtensionContextValue`](/reference/react/interfaces/maelstromextensioncontextvalue/)

Defined in: packages/react/src/lib/extension-types.ts:32

#### Returns

[`MaelstromExtensionContextValue`](/reference/react/interfaces/maelstromextensioncontextvalue/)
