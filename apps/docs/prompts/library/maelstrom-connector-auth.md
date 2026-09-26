---
id: maelstrom-connector-auth
prompt_version: 1.0.0
compatibility:
  sdk:
    "@maelstrom-co/connectors": "0.1.0-alpha.4"
    "@maelstrom-co/client": "0.1.0-alpha.4"
---

Design or implement the transport and application-authentication boundary for
this Maelstrom integration.

Goal: [USER / PRODUCT GOAL]
Existing authentication: [DETAILS OR "inspect"]
Connector / transport: [DETAILS OR "inspect"]
Engine host: [DETAILS OR "inspect"]
Implementation authorized: [YES / NO]

## Inspect first

Inspect installed package versions and the app's session/auth code, Connector
configuration, request/route boundary, deployment environment, and relevant
failure handling. Confirm current Connector constructors, interfaces, and
connection lifecycle from the installed package exports, types, source, and
version-matched docs. Do not invent an endpoint, token format, retry policy, or
Engine contract where repository evidence is absent; list it as a question.

## Boundaries

- Keep the Connector focused on moving Envelopes (or their HTTP equivalents)
  across the selected transport. Do not put Vessel mutation, layout decisions,
  product policy, or application authorization inside it.
- Authentication and authorization remain application-owned. Reuse the current
  session mechanism only if the inspected transport supports it safely; otherwise
  identify the smallest explicit app-owned server boundary.
- Never request, print, commit, or place literal credentials in browser code.
  Provider keys stay server-side. Use secret references only, and review the
  diff for accidental credential material.
- Distinguish retryable transport failures, cancellation/disposal, authentication
  expiry, authorization rejection, and terminal errors using behavior actually
  supported by the selected Connector. Do not add blind retry loops or claim
  retries are safe for a request with side effects.
- Do not silently alter unrelated registry, auth, routing, or transport config.

If implementation is authorized, make only the bounded changes approved by the
goal after inspection. Otherwise return a plan and make no edits. Add deterministic
tests for supported request/auth/error behavior without calling a real service.
Run affected checks and report exact commands. Separate test-double results from
live transport verification.

Return an ownership/sequence outline, evidence-backed API/version anchors,
changed files or plan, expiry/reconnect/cancel/error handling, redaction review,
tests and actual results, open questions, and rollback steps.