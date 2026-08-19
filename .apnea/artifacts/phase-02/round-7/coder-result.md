---
status: done
---

Fixed the registry proof test ordering and strengthened arbiter eligibility evidence.

Changes:
- Records `skipped` terminal proof before retiring the entry, then recreates the registry entry and asserts the retained coordinator still exposes that proof.
- Settles the active response in the committed-first arbiter case and proves the queued eligible turn drains.

Files touched:
- `packages/react-realtime/src/lib/shared-realtime-session.test.ts`
- `packages/realtime-openai/src/response-arbiter.test.ts`

Verification transcript (command — exit — tail):

```text
bun test packages/realtime-openai/src/response-arbiter.test.ts — 0
9 pass, 0 fail

bun test --conditions=@maelstrom-co/source --preload ./packages/react-realtime/src/lib/__tests__/setup.ts packages/react-realtime/src/lib/shared-realtime-session.test.ts — 0
5 pass, 0 fail

if rg -n "response-lifecycle" packages/realtime-openai/src --glob '!index.ts'; then exit 1; fi — 0
No implementation/import matches. The sole excluded match is the pre-existing comment in prohibited public barrel `packages/realtime-openai/src/index.ts`.
```

Residual risks:
- The full replacement/teardown/interruption presentation and re-entrant arbiter sequences remain covered by adapter-level characterization rather than exhaustive direct owner-interface tests.
- The registry direct suite proves pre-existing `skipped` retention; `presented` and `suppressed` terminal proof is covered by the retained coordinator mechanism but has not been driven in an equivalent direct registry test.
- The serial repository gate was not rerun. Docs E2E passed in round 6. No acoustic claim was added; mobile timing, echo removal, VAD accuracy, and first-phoneme preservation remain unverified.
