---
name: maelstrom-react-realtime-sdk
description: >-
  Version-matched API guide for @maelstrom-co/react-realtime. Load when implementing or
  reviewing this package's APIs and it is installed; check the owning installed package manifest before relying on API names.
license: MIT
metadata:
  author: Maelstrom
  sdkPackage: '@maelstrom-co/react-realtime'
---

# @maelstrom-co/react-realtime

This guide is published inside `@maelstrom-co/react-realtime`; its package version is its
API version. Before use, read the installed
package's `package.json` version as the version authority. If the guide is
not shipped by that exact installed package, do not rely on it:
inspect that installation's `exports`, declarations, source, and tests.

Package scope: React bindings for Maelstrom realtime voice: the maelstromRealtime() extension, useVoice, VoiceOrb, and a createLevelMeter audio-metering utility.

Confirm every symbol against this installed package's public exports and
declarations. Preserve its documented runtime and dependency boundaries; do not
move behavior owned by adjacent packages or the consuming application into this
package.

When adding voice to a React instance, read
[common tasks](references/common-tasks.md) for extension and hook ownership.
