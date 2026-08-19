---
status: done
---

Expanded direct owner-interface characterization where the review identified missing proof.

Changes:
- Registry test now proves a retained coordinator's actual `skipped` terminal snapshot survives session recreation, rather than asserting object identity alone.
- Added registry coverage that concurrent final releases queue one retirement/disconnect.
- Added greeting-presentation coverage that microphone publication remains gated after synthesis through pending playback, and restores only when playback resolves.

Files touched:
- `packages/react-realtime/src/lib/shared-realtime-session.test.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`

Verification transcript (command — exit — tail):

```text
bunx biome check packages/react-realtime/src/lib/shared-realtime-session.test.ts packages/realtime-openai/src/greeting-presentation.test.ts --write — 0
Checked 2 files. No fixes applied.

bun test packages/realtime-openai/src/greeting-presentation.test.ts — 0
9 pass, 0 fail

bun test --conditions=@maelstrom-co/source --preload ./packages/react-realtime/src/lib/__tests__/setup.ts packages/react-realtime/src/lib/shared-realtime-session.test.ts — 0
6 pass, 0 fail
```

Residual risks:
- Direct registry tests still need `presented`/`suppressed` recreation proof and deferred disconnect completion/rejection isolation. Arbiter malformed/duplicate/newer completion and additional re-entrant event projections remain partial. Presentation interruption and privacy-diagnostic cases remain partial.
- The serial repository gate passed in round 12 before these test-only additions; it was not rerun in this round.
- No acoustic claim was added; mobile timing, echo removal, VAD accuracy, and first-phoneme preservation remain unverified.
