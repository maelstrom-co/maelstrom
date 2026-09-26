# Observability prompt checklist

Use with `maelstrom-observability` and a disposable integration exposing a bounded
set of SDK events and a fake telemetry sink.

- [ ] Chosen event names and payload fields are evidenced by installed source/types/tests.
- [ ] Event selection is bounded to the stated diagnostic goal and listener cleanup is owned by a real lifecycle.
- [ ] Redaction excludes credentials, intent/prompt contents, Vessel props, and sensitive user data by default.
- [ ] No duplicate product state or unsupported/high-cardinality telemetry is introduced.
- [ ] Deterministic tests and local fake-sink results are distinguished from deployed telemetry delivery.
- [ ] Unsupported event gaps are reported, not papered over with invented SDK contracts.