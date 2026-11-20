---
editUrl: false
next: false
prev: false
title: "MaelstromProviderProps"
---

> **MaelstromProviderProps** = `TilingProviderProps` \| `GridProviderProps`

Defined in: packages/react/src/lib/provider.tsx:35

Props for the Maelstrom Provider component.

Split by `layoutMode` so the one combination the Orchestrator can only
reject at runtime — a first-screen seed under `layoutMode: 'grid'` — is
unrepresentable in TypeScript rather than a guaranteed construction
failure that typechecks.
