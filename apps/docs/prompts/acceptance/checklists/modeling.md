# Vessel modeling prompt checklist

Use with `maelstrom-vessel-modeling` and `fixtures/modeling-react`.

- [ ] The inventory points to the fixture's `src/Queue.tsx` and identifies the
      queue as the Engine-selectable capability, not its controls as separate
      Vessels.
- [ ] The behavior table records initial query `""`, visible filtered results,
      empty-results message, and Reset restoring an empty query; each is tied to
      the actual component source.
- [ ] The operation table records Reset as local input reset, with no server/API
      effect; no unobserved actions or states are proposed.
- [ ] The prompt treats results as derived from the local static data and does
      not claim remote search, persistence, or mutation.
- [ ] The proposal permits a single Variant with no Actions if no useful
      distinction is established; descriptions use user language, not component
      implementation details.
- [ ] If implementation was separately authorized, selected rendering and the
      empty/reset boundaries have tests; no unsupported API or unsafe cast is
      introduced. Otherwise no edits are made.
- [ ] Exact checks and rollback are given; no live Engine verification is claimed
      without evidence.
