---
editUrl: false
next: false
prev: false
title: "LiveKitTokenGrantSchema"
---

> `const` **LiveKitTokenGrantSchema**: `z.ZodObject`\<\{ `expiresAt`: `z.ZodPipe`\<`z.ZodNumber`, `z.ZodTransform`\<`UnixSeconds`, `number`\>\>; `token`: `z.ZodString`; `url`: `z.ZodURL`; \}, `z.core.$strip`\>

Defined in: packages/realtime-protocol/dist/lib/livekit-token.d.ts:35

Wire schema for [LiveKitTokenGrant](/reference/realtime-livekit/interfaces/livekittokengrant/).
