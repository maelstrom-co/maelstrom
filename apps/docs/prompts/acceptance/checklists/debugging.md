# Debugging prompt checklist

Use with `maelstrom-debugging` and `fixtures/debugging-react`.

- [ ] The report separates observed facts from hypotheses and classifies the
      connector/transport symptom independently from intent processing.
- [ ] It uses `connectionStatus`, `connectionError`, `isProcessing`, `lastError`,
      `lastResponse`, Provider `onError`, and server logs only where available in
      the installed version; missing evidence is marked unknown.
- [ ] It identifies the fixture's `ECONNREFUSED` and `lastResponse: null` as
      transport evidence; it does not infer that an intent was processed or
      rejected by the Engine.
- [ ] It identifies the separate synthetic server record `request accepted`,
      `processing started`, `provider timeout` as evidence of a processing
      failure on that distinct attempt, not the refused browser attempt.
- [ ] It does not claim the two correlation IDs describe one request or merge
      the two failures into a single confirmed root cause.
- [ ] It makes no edits for diagnose-only authority and does not recommend
      credential disclosure. Evidence and suggested next checks are redacted.
- [ ] Any implementation fix is applied only under explicit authority and after
      a confirmed cause; exact checks and unresolved infrastructure needs are
      reported.
