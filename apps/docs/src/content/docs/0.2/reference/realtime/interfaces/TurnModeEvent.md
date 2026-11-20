---
editUrl: false
next: false
prev: false
title: "TurnModeEvent"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:63

Reports the usable turn mode for the current adapter connection. `error` is
present only when attempted automatic control degraded to manual mode; a
clean event clears any diagnostic retained from an earlier mode.

## Properties

### error?

> `readonly` `optional` **error?**: `unknown`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:72

Automatic-mode degradation cause; omitted for a clean mode transition.

***

### mode

> `readonly` **mode**: [`TurnMode`](/reference/realtime/type-aliases/turnmode/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:70

Mode ready for consumers when this event is delivered. Before emitting
`manual`, an adapter must expose its current [AdapterTurnControl](/reference/realtime/interfaces/adapterturncontrol/).

***

### type

> `readonly` **type**: `"turn_mode"`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:65

Event discriminator.
