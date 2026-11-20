---
editUrl: false
next: false
prev: false
title: "AGENT_WIRE_VERSION"
---

> `const` **AGENT\_WIRE\_VERSION**: `1`

Defined in: packages/protocol/src/lib/agent-wire.ts:23

Version of the agent wire contract that every [AgentInput](/reference/protocol/type-aliases/agentinput/) and
[AgentEvent](/reference/protocol/type-aliases/agentevent/) carries in its `version` field. An integer, not semver.
A new optional field on a member keeps the version, because decoders strip
keys they do not know. A new union member or enum value is rejected by an
older decoder as `invalid_envelope`, so such a change bumps the version.
The wire is unstable until the client event applier ships, and version
bumps apply from then on. Decoders reject any other version value.
