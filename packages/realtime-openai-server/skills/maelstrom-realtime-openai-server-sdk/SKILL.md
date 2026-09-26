---
name: maelstrom-realtime-openai-server-sdk
description: >-
  Version-matched API guide for @maelstrom-co/realtime-openai-server. Load when implementing or
  reviewing this package's APIs and it is installed; check the owning installed package manifest before relying on API names.
license: MIT
metadata:
  author: Maelstrom
  sdkPackage: '@maelstrom-co/realtime-openai-server'
---

# @maelstrom-co/realtime-openai-server

This guide is published inside `@maelstrom-co/realtime-openai-server`; its package version is its
API version. Before use, read the installed
package's `package.json` version as the version authority. If the guide is
not shipped by that exact installed package, do not rely on it:
inspect that installation's `exports`, declarations, source, and tests.

Package scope: Server-only minting of ephemeral OpenAI realtime credentials for Maelstrom. Never ships to the browser.

Confirm every symbol against this installed package's public exports and
declarations. Preserve its documented runtime and dependency boundaries; do not
move behavior owned by adjacent packages or the consuming application into this
package.
