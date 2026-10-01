---
name: maelstrom-realtime-livekit-agent-sdk
description: >-
  Version-matched API guide for @maelstrom-co/realtime-livekit-agent. Load when implementing or
  reviewing this package's APIs and it is installed; check the owning installed package manifest before relying on API names.
license: MIT
metadata:
  author: Maelstrom
  sdkPackage: '@maelstrom-co/realtime-livekit-agent'
---

# @maelstrom-co/realtime-livekit-agent

This guide is published inside `@maelstrom-co/realtime-livekit-agent`; its package version is its
API version. Before use, read the installed
package's `package.json` version as the version authority. If the guide is
not shipped by that exact installed package, do not rely on it:
inspect that installation's `exports`, declarations, source, and tests.

Package scope: Node LiveKit voice agent worker for Maelstrom: transcribes room audio via Deepgram STT and publishes the transcript back to the room; synthesizes engine responses via Cartesia TTS and publishes them into the room as an audio track.

Confirm every symbol against this installed package's public exports and
declarations. Preserve its documented runtime and dependency boundaries; do not
move behavior owned by adjacent packages or the consuming application into this
package.
