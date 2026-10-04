# Synthetic redacted incident input

Use this report only with diagnose-only authority unless a separate request
explicitly authorizes a fix. The following are two distinct attempts; correlation
IDs must not be combined.

## Browser attempt `req-browser-17`

- `m.useMaelstrom()` snapshot: `connectionStatus = "connecting"`,
  `connectionError = "ECONNREFUSED"`, `isProcessing = false`, `lastError = null`,
  `lastResponse = null`.
- Browser Connector log: `POST /engine/intent` failed to connect; no HTTP status
  was received.
- Provider `onError`: not captured.
- Server Engine log for this correlation ID: none supplied.

## Separate server attempt `req-server-42`

- Server log: `request accepted`; `processing started`; `provider timeout`;
  response status 504.
- Browser state snapshot and Provider `onError`: not supplied for this attempt.

No credentials, tokens, hostnames, or user content are included. These events are
synthetic and do not assert live Maelstrom behavior.
