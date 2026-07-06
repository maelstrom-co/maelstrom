# @maelstrom-co/livekit-voice

Browser-side LiveKit voice extension for Maelstrom — adds `useVoice` to a
Maelstrom instance via `.with(liveKitVoice({ getToken }))`.

## Subpaths

- `.` — the `liveKitVoice()` extension and voice API (browser).
- `./protocol` — zero-dependency wire constants shared with the agent worker.
- `./server` — `mintLiveKitToken` token minting (Node; never bundled into the browser).
