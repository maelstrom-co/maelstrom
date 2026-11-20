---
editUrl: false
next: false
prev: false
title: "MaelstromExtension"
---

> **MaelstromExtension**\<`Out`\> = (`ctx`) => `Out`

Defined in: packages/react/src/lib/extension-types.ts:62

Factory function that receives the extension context and returns
additional fields to be merged onto the `MaelstromInstance`.

Extension authors implement this type to create addons (voice, analytics,
devtools, etc.) and consumers apply them via `instance.with(extension)`.

Extensions must return a plain object synchronously. Async factories,
arrays, and primitive values are rejected at compile time via the
`ExtensionOutput` constraint.

## Type Parameters

### Out

`Out` *extends* `ExtensionOutput`

## Parameters

### ctx

[`MaelstromExtensionContext`](/reference/react/interfaces/maelstromextensioncontext/)

## Returns

`Out`

## Example

```ts
const myExtension: MaelstromExtension<{ greet: () => string }> = (ctx) => ({
  greet: () => 'Hello from extension!',
});

const m = createMaelstrom({ vessels }).with(myExtension);
m.greet(); // 'Hello from extension!'
```
