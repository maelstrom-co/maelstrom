# Connector and application authentication boundary

The Connector carries Envelopes (or their HTTP equivalents) across a transport. Keep Vessel mutation, layout policy, product decisions, and application authorization outside it. Inspect the actual Connector configuration, session/auth design, route boundary, deployment, and failure lifecycle before proposing a change.

Authentication and authorization remain app-owned. Reuse the existing session mechanism only if the selected transport supports it safely; otherwise identify a minimal explicit app-owned server boundary. Never request or copy literal credentials. Provider keys stay server-side. Distinguish retryable failures, cancellation/disposal, authentication expiry, authorization rejection, and terminal errors only where the selected version supports those cases. Do not retry side-effecting operations blindly.

Check constructor/interface/error contracts in installed exports, types, source, tests, and matching docs. A local stub verifies only that stubbed path; it does not establish a live transport, server, or Engine check. Public overview: [connectors guide](https://maelstrom.co/understanding/connectors/).
