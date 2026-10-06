---
name: maelstrom-realtime-openai-sdk
description: >-
  Version-matched API guide for @maelstrom-co/realtime-openai. Load when implementing or
  reviewing this package's APIs and it is installed; check the owning installed package manifest before relying on API names.
license: MIT
metadata:
  author: Maelstrom
  sdkPackage: '@maelstrom-co/realtime-openai'
---

# @maelstrom-co/realtime-openai

This guide is published inside `@maelstrom-co/realtime-openai`; its package version is its
API version. Before use, read the installed
package's `package.json` version as the version authority. If the guide is
not shipped by that exact installed package, do not rely on it:
inspect that installation's `exports`, declarations, source, and tests.

Package scope: OpenAI browser adapter for Maelstrom realtime voice: a RealtimeProviderAdapter over client-direct WebRTC to gpt-realtime.

Confirm every symbol against this installed package's public exports and
declarations. Preserve its documented runtime and dependency boundaries; do not
move behavior owned by adjacent packages or the consuming application into this
package.

When configuring the browser adapter, read
[common tasks](references/common-tasks.md) for grant injection and provider behavior.
