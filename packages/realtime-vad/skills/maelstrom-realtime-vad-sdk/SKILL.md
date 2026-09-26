---
name: maelstrom-realtime-vad-sdk
description: >-
  Version-matched API guide for @maelstrom-co/realtime-vad. Load when implementing or
  reviewing this package's APIs and it is installed; check the owning installed package manifest before relying on API names.
license: MIT
metadata:
  author: Maelstrom
  sdkPackage: '@maelstrom-co/realtime-vad'
---

# @maelstrom-co/realtime-vad

This guide is published inside `@maelstrom-co/realtime-vad`; its package version is its
API version. Before use, read the installed
package's `package.json` version as the version authority. If the guide is
not shipped by that exact installed package, do not rely on it:
inspect that installation's `exports`, declarations, source, and tests.

Package scope: Provider-neutral browser voice-activity detection for Maelstrom realtime voice: a MediaStream in, speech boundaries out.

Confirm every symbol against this installed package's public exports and
declarations. Preserve its documented runtime and dependency boundaries; do not
move behavior owned by adjacent packages or the consuming application into this
package.
