---
name: maelstrom-devtools-sdk
description: Version-matched guide for framework-independent Maelstrom devtools collectors, browser mounting, and capture inspection.
license: MIT
metadata:
  author: Maelstrom
  sdkPackage: '@maelstrom-co/devtools'
---

Read the installed package's `package.json` version as the version authority.
Confirm exports and declarations from that installation before choosing options.

Use this package for the shared collector and browser panel. Attach the collector
before connecting the application-owned Orchestrator. Keep connection setup and
business Actions in the application. Keep framework lifecycle wiring in its
adapter package.

Automatic observations contain metadata. Content requires explicit capture and
passes through redaction before retention. Preserve independent Provider
lifetimes and release their subscriptions without erasing retained evidence.
Opening a capture is read-only. Engine forwarding belongs in the server-owned
`createDiagnosticConnection` helper, with explicit host opt-in and session binding.
The default production entrypoint is inert. The `/production` entrypoint enables
browser collection and explicit capture in every build without changing server policy.

For attachment, capture, and cleanup examples, read
[common tasks](references/common-tasks.md).
