---
name: maelstrom-devtools-protocol-sdk
description: Version-matched guide for Maelstrom DevTools MCP wire contracts. Load when validating bridge messages, implementing an inspection transport, or interpreting bounded query results.
license: MIT
metadata:
  author: Maelstrom
  sdkPackage: '@maelstrom-co/devtools-protocol'
---

Read the installed package's `package.json` version as the version authority.
Confirm exports and declarations from that installation before choosing options.

Use these runtime-neutral schemas on both sides of the local inspection seam.
Enforce the envelope byte limit before parsing. Validate correlated responses
against the requested operation as well as their schema.

Target handles identify one authenticated browser connection. App handles identify
one lifetime within that connection. Reported identities remain projected strings;
redaction can remove their domain guarantees. Unavailable and colliding identities
remain unknown. Preserve the result's source, loss scope, and timing provenance.

The pairing revision, read operations, and failure codes define the supported
capabilities. Application control and content recording need separate contracts.

For validation and result-handling examples, read
[common tasks](references/common-tasks.md).
