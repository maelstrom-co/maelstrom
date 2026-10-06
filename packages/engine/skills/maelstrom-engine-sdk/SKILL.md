---
name: maelstrom-engine-sdk
description: >-
  Version-matched API guide for @maelstrom-co/engine. Load when implementing or
  reviewing this package's APIs and it is installed; check the owning installed package manifest before relying on API names.
license: MIT
metadata:
  author: Maelstrom
  sdkPackage: '@maelstrom-co/engine'
---

# @maelstrom-co/engine

This guide is published inside `@maelstrom-co/engine`; its package version is its
API version. Before use, read the installed
package's `package.json` version as the version authority. If the guide is
not shipped by that exact installed package, do not rely on it:
inspect that installation's `exports`, declarations, source, and tests.

Package scope: Reference LLM decision core for Maelstrom: turns chart state and user intent into a layout and an execution plan.

Confirm every symbol against this installed package's public exports and
declarations. Preserve its documented runtime and dependency boundaries; do not
move behavior owned by adjacent packages or the consuming application into this
package.

When wiring a planner or history policy, read
[common tasks](references/common-tasks.md) for server ownership and verification.
