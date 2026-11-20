---
editUrl: false
next: false
prev: false
title: "resolveConfig"
---

> **resolveConfig**(`config`): `ResolvedEngineConfig`

Defined in: packages/engine/src/lib/config.ts:82

Applies Engine defaults without cloning configured dependencies.

The logger defaults to [consoleLogger](/reference/engine/variables/consolelogger/), the instrument to
[noopInstrument](/reference/engine/variables/noopinstrument/) and `retry` to `{ max: 1 }`;
history remains optional.

## Parameters

### config

[`EngineConfig`](/reference/engine/interfaces/engineconfig/)

## Returns

`ResolvedEngineConfig`
