---
name: maelstrom-react-sdk
description: >-
  Version-matched API guide for @maelstrom-co/react. Load when implementing or
  reviewing Maelstrom React bindings and this package is installed; check the owning installed package manifest before relying on API names.
license: MIT
metadata:
  author: Maelstrom
  sdkPackage: '@maelstrom-co/react'
---

# Maelstrom React SDK

This guide is published inside its owning package. Before use, read the
installed package's `package.json` version as the version authority. If the guide
is not shipped by that exact installed package, do not rely on it: inspect the
installation's `exports`, declarations, source, and tests instead.

The installed public entrypoint exports `createMaelstrom`, `vessel`, and
`defineVessel`, and exposes the `ChartProps` and `MaelstromProviderProps` types.
Confirm names and call signatures against the installed entrypoint/declarations
before use; do not assume `MaelstromProvider` itself is a named export just
because that type exists. Keep framework-independent lifecycle and connection
logic in its owning SDK package; application data, authorization, and side
effects remain application-owned.
