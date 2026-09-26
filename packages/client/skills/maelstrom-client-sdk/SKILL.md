---
name: maelstrom-client-sdk
description: >-
  Version-matched API guide for @maelstrom-co/client. Load when implementing or
  reviewing framework-independent Maelstrom client APIs and this package is
  installed; check the owning installed package manifest before relying on its API names.
license: MIT
metadata:
  author: Maelstrom
  sdkPackage: '@maelstrom-co/client'
---

# Maelstrom client SDK

This guide is published inside its owning package. Before use, read the
installed package's `package.json` version as the version authority. If the guide
is not shipped by that exact installed package, do not rely on it: inspect the
installation's `exports`, declarations, source, and tests instead.

Use this package for framework-independent client contracts and operations.
Its public entrypoint includes `Orchestrator`, `ChartManager`, `VesselManager`,
`ActionManager`, `CommandProcessor`, `ConnectionManager`, `HttpConnector`, and
`WebSocketConnector`; confirm the exact signatures in the installed entrypoint
before use. Apply an Engine response in its declared order: set layout before
executing Actions, so Actions may target Instances introduced by that response.
Grid calculations use Chart dimensions, not the browser viewport.

Keep framework bindings in `@maelstrom-co/react`, provider implementations in
their owning packages, and application data/auth/effects in the application.
The Engine plans; client-owned chart state and action execution remain client
concerns.
