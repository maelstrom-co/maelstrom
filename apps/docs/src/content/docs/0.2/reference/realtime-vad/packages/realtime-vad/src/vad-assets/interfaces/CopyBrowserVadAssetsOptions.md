---
editUrl: false
next: false
prev: false
title: "CopyBrowserVadAssetsOptions"
---

Defined in: packages/realtime-vad/src/vad-assets.ts:31

Options for package-owned browser VAD asset deployment.

## Properties

### outputDir

> `readonly` **outputDir**: `string`

Defined in: packages/realtime-vad/src/vad-assets.ts:38

Dedicated child directory for generated VAD assets. Relative paths are
resolved from the caller's current working directory. The working
directory, its ancestors, filesystem roots, symbolic links, and existing
non-directory targets are rejected.
