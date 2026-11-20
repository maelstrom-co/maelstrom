---
editUrl: false
next: false
prev: false
title: "CircuitStatus"
---

> **CircuitStatus** = `"closed"` \| `"open"` \| `"half_open"`

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:69

Circuit-breaker phase for engine connection attempts.

`closed` permits normal attempts, `open` rejects explicit
[ConnectionManager.connect](/reference/client/classes/connectionmanager/#connect) calls, and `half_open` marks the automatic
recovery probe started after the reset timeout.
