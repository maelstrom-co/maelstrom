---
editUrl: false
next: false
prev: false
title: "copyBrowserVadAssets"
---

> **copyBrowserVadAssets**(`__namedParameters`): `Promise`\<readonly `string`[]\>

Defined in: packages/realtime-vad/src/vad-assets.ts:136

Copies the VAD worklet, every supported Silero model, and the matching ONNX
Runtime browser modules from this package's pinned dependencies.

The destination must be a dedicated child directory because its existing
contents are atomically replaced. The complete manifest is copied and
validated in a unique sibling staging directory before the destination is
touched. Existing helper-owned staging or backup siblings reject before
staging or destination mutation; sibling names outside this output's exact
helper basename, transaction kind, and UUID format are ignored. Installing
the validated stage is the commit point: failures before it attempt to
restore the prior destination, while a later backup-removal failure preserves
the complete new destination, leaves any remaining backup visible for
fail-closed recovery, and rejects. Failed pre-commit rollback steps are
reported with the original failure in an `AggregateError`.

## Parameters

### \_\_namedParameters

[`CopyBrowserVadAssetsOptions`](/reference/realtime-vad/packages/realtime-vad/src/vad-assets/interfaces/copybrowservadassetsoptions/)

## Returns

`Promise`\<readonly `string`[]\>

Copied paths relative to the resolved destination, sorted
lexicographically and normalized to `/` separators.
