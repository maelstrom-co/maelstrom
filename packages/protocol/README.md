# @maelstrom-co/protocol

[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

Shared types, Zod schemas, and message envelopes for Maelstrom. Both the engine and everything that talks to it import from this package — the protocol is the contract that survives implementation changes.

📚 **Full documentation:** <https://docs.maelstrom-ai.co/reference/protocol/readme/>

The protocol is transport-agnostic. WebSocket, HTTP, in-process, or your own carrier — every payload is the same shape on both sides.

> Looking for an introduction? See [The Protocol](https://docs.maelstrom-ai.co/understanding/protocol) on the docs site. This README is the technical reference for the package surface.

---

## Quickstart

```ts
import {
  ChartRequestMessage,
  SessionId,
  defineVessel,
  validateVessel,
} from '@maelstrom-co/protocol';

const calendar = defineVessel({
  id: 'calendar',
  name: 'Calendar',
  description: 'Shows a month or week view',
  defaultVariant: 'month',
  variants: {
    month: {
      props: {},
      minSize: { width: 4, height: 3 },
      actions: [
        {
          name: 'showWeek',
          description: 'Switch to a week view',
          transitionsTo: 'week',
        },
      ],
    },
    week: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [],
    },
  },
});

const validation = validateVessel(calendar);
if (!validation.valid) {
  throw new Error(validation.issues.map((i) => i.message).join(', '));
}

const message = ChartRequestMessage({
  sessionId: SessionId('user-42'),
  request: /* build a ChartRequest */,
});
```

---

## Branded IDs

Every identifier in Maelstrom is a branded string — structurally `string`, nominally distinct. Brands prevent the confusion bugs that pure-string IDs invite (passing a `VesselId` where an `InstanceId` was expected) and erase to plain strings on the wire.

| Brand          | Auto-generated      | Used for                                  |
|----------------|---------------------|-------------------------------------------|
| `SessionId`    | `session-<Nano ID>` | One conversation                          |
| `MessageId`    | Nano ID             | One envelope                              |
| `InstanceId`   | No                  | One mounted vessel on the chart           |
| `VesselId`     | No                  | A registered vessel type                  |
| `VariantName`  | No                  | A state within a vessel                   |
| `ActionName`   | No                  | A transition exposed by a variant         |

```ts
import { SessionId, VesselId, MessageId } from '@maelstrom-co/protocol';

const session = SessionId();             // auto-generated, e.g. session-<nanoid>
const explicit = SessionId('user-42');   // existing identifier

const vessel = VesselId('calendar');     // always developer-provided

session === vessel;  // type error — different brands
```

`SessionId()` and `MessageId()` accept an optional override so you can rehydrate stored sessions or supply deterministic IDs in tests. The remaining brands accept only an explicit value — empty strings are rejected at construction.

---

## Message envelopes

Every input to the engine is an `EngineMessage` — a tagged envelope carrying `sessionId`, `id`, and `timestamp` alongside the variant payload. Outputs use the same envelope pattern with `EngineOutput`, carrying `sessionId` and `id` so callers can correlate request and response.

```ts
type EngineMessage =
  | { type: 'chart_request';     sessionId; id; timestamp; request }
  | { type: 'assistant_message'; sessionId; id; timestamp; content };

type EngineOutput =
  | { type: 'chart_response';           sessionId; id; response }
  | { type: 'assistant_message_result'; sessionId; id; outcome };
```

### Variants

**`ChartRequestMessage`** — asks the engine for a layout and execution plan. Carries a `ChartRequest` describing the current chart state, registered vessels, and the reasons for the update.

**`AssistantInjectionMessage`** — persists developer-supplied content into session history without invoking the LLM. The corresponding `assistant_message_result` output reports `outcome: 'inserted' | 'deduped'` so idempotent replay paths can branch.

### Smart constructors

Envelopes are constructed via factories that share their name with their type (the identifier doubles as type and value, exploiting TypeScript's separate namespaces). The factory fills in `id` (UUID) and `timestamp` (`Date.now()`) unless you pass them.

```ts
import {
  ChartRequestMessage,
  AssistantInjectionMessage,
  SessionId,
  MessageId,
} from '@maelstrom-co/protocol';

const chartMsg = ChartRequestMessage({
  sessionId: SessionId('user-42'),
  request: buildChartRequest(),
});

// Explicit id/timestamp when you need them (rehydration, replay, tests)
const injection = AssistantInjectionMessage({
  sessionId: SessionId('user-42'),
  content: 'FYI: flights tend to be cheaper on Tuesdays.',
  id: MessageId('injection-1'),
  timestamp: 1_700_000_000_000,
});
```

A non-finite `timestamp` (`NaN`, `±Infinity`) is rejected at construction — it would silently corrupt history ordering, which sorts by this field.

---

## ChartRequest

The payload carried inside `ChartRequestMessage`. It tells the engine everything it needs to make a decision: chart dimensions, layout mode, current vessel instances, registered vessel definitions, and the reasons that triggered the request.

```ts
interface ChartRequest {
  type: 'chart_request';
  context: {
    updateReasons: readonly UpdateReason[];
    chartDimensions: ChartDimensions;
    layoutMode: 'grid' | 'tiling';
  };
  instances: readonly VesselInstanceSnapshot[];
  vessels: readonly Vessel[];
  layout: GridLayout | TilingLayout;
}
```

Identity (`id`), session binding (`sessionId`), and timestamp live on the surrounding envelope, not in this payload.

### Update reasons

Three discriminated reasons can trigger an update. A single `ChartRequest` can batch any combination — the engine considers them together.

```ts
type UpdateReason =
  | { type: 'user_intent';     intent: string }
  | { type: 'chart_resize';    previous: ChartDimensions; current: ChartDimensions }
  | { type: 'vessel_mutation'; instanceId: InstanceId; changes: string };
```

- **`user_intent`** — text the user typed or spoke.
- **`chart_resize`** — the chart container changed size; carries before/after, not a delta.
- **`vessel_mutation`** — an active vessel changed state.

### Vessel instance snapshots

Each currently-mounted vessel is described as a snapshot:

```ts
interface VesselInstanceSnapshot {
  instanceId: InstanceId;
  vesselId: VesselId;
  variant: VariantName;
}
```

---

## MaelstromResponse

The payload returned inside `ChartResponseOutput`.

```ts
interface MaelstromResponse {
  type: 'maelstrom_response';
  requestId: MessageId;
  userMessage?: string;
  rationale?: string;
  executionPlan: readonly ActionExecution[];
  layout: GridLayout | TilingLayout;
}

interface ActionExecution {
  instanceId: InstanceId;
  action: string;
  params?: Record<string, unknown>;
}
```

`requestId` echoes the originating envelope `id` so callers can correlate without external bookkeeping. `executionPlan` lists action invocations to apply after the layout transition. `userMessage` is optional natural-language presentation for end users; `rationale` is optional diagnostic reasoning. Clients must handle either field being absent and must not invent placeholder prose.

### Optional-text migration

Response `userMessage` and `rationale`, and turn-shaped history
`assistantMessage`, now have type `string | undefined`. This relaxes the wire
contract but requires a TypeScript source migration for readers that assumed
strings. Release protocol, engine, client, React, and reverse consumers together.

```ts
import type { MaelstromResponse, SessionHistoryEntry } from '@maelstrom-co/protocol';

export function responseText(response: MaelstromResponse): string[] {
  const lines: string[] = [];
  if (response.userMessage !== undefined) lines.push(response.userMessage);
  if (response.rationale !== undefined) lines.push(response.rationale);
  return lines;
}

export function historyText(entry: SessionHistoryEntry): string[] {
  if (entry.kind === 'injection') return [entry.content];
  return entry.assistantMessage === undefined
    ? [entry.userIntent]
    : [entry.userIntent, entry.assistantMessage];
}
```

Render only present text. A text-free accepted plan still applies layout before
ordered actions, including actions targeting newly declared tiling instances.
It clears processing state without an empty response card; public history can
show the user turn without an assistant bubble. Do not insert fake “Done” text
into the wire response. Realtime consumers can use their post-render structural
summary when text is absent; that summary is separate from response prose.

The canonical `MaelstromResponseSchema` is shared by HTTP response decoding
and WebSocket envelope decoding. Both accept omitted prose and reject malformed
layout/action shapes. The conventional LLM's `GridResponseSchema` and
`TilingResponseSchema` still request text; those model-output schemas are not
the finalized wire-response contract.

---

## Layouts

### Grid

Explicit `(row, column, width, height)` placement on a discrete grid. The engine emits one `GridPosition` per visible instance.

```ts
interface GridLayout {
  type: 'grid';
  positions: readonly GridPosition[];
}

interface GridPosition {
  instanceId: InstanceId;
  position: { row: number; column: number };
  size: { width: number; height: number };
}
```

### Tiling

A split tree of horizontal / vertical divisions with instance leaves, expressed as a preorder array. A split token is an axis, optionally followed by `:` and comma-separated integer weights — and the weight count declares the token's arity.

```ts
interface TilingLayout {
  type: 'tiling';
  tree: readonly TilingNode[];      // 'H' | 'V' | `ID:${InstanceId}` | null
  instances: readonly TilingInstance[];
}

interface TilingInstance {
  instanceId: InstanceId;
  vesselId: string;
  variant: string;
}
```

A leaf carries the mandatory `ID:` prefix, so no Instance ID can be mistaken for a split token — an Instance called `H:hero` appears as `ID:H:hero`. Build leaves with `tilingLeafToken` and read them with `tilingLeafInstanceId` rather than slicing the prefix by hand:

```ts
import {
  isTilingSplit,
  tilingLeafInstanceId,
  tilingLeafToken,
} from '@maelstrom-co/protocol';

const tree = ['V', tilingLeafToken(calendarId), tilingLeafToken(tasksId)];

for (const node of layout.tree) {
  const instanceId = tilingLeafInstanceId(node);
  if (instanceId !== null) { /* a leaf naming instanceId */ }
  else if (isTilingSplit(node)) { /* 'H', 'V', or a weighted token */ }
  else { /* null — empty subtree */ }
}
```

Classification is not enough to walk the tree, because a split's arity is declared rather than fixed at two. A two-child walker over an n-ary tree fails silently: it consumes two subtrees from a token that declared six, and every token after that is read at the wrong position.

```ts
import {
  isTilingSplit,
  parseTilingSplitToken,
  type TilingNode,
} from '@maelstrom-co/protocol';

/** Consumes the subtree starting at `index`; returns the index just past it. */
function walk(tree: readonly TilingNode[], index: number): number {
  const node = tree[index];
  if (node === undefined) return index;

  if (isTilingSplit(node)) {
    const { weights } = parseTilingSplitToken(node);
    let cursor = index + 1;
    for (let child = 0; child < weights.length; child++) {
      cursor = walk(tree, cursor);
    }
    return cursor;
  }

  // A leaf: an `ID:`-prefixed Instance token, or null for empty space.
  return index + 1;
}
```

#### Split tokens and weights

| Token | Children | Proportions |
| ----- | -------- | ----------- |
| `'V'` | 2 | 50% / 50%, left to right |
| `'H'` | 2 | 50% / 50%, top to bottom |
| `'V:1,1,1'` | 3 | one third each, left to right |
| `'H:2,1'` | 2 | two thirds top, one third bottom |

- **The number of weights is the number of children.** `'V:1,1,1'` consumes the next three subtrees from the preorder array, not two.
- Each child takes `weight / sum(weights)` of the parent region along the axis, so a weight is a share relative to its siblings rather than a fraction of the parent. Bare `'H'` / `'V'` mean exactly `[1, 1]` and stay the preferred spelling for an even two-way split.
- A token declares between 2 and `MAX_SPLIT_CHILDREN` (12) weights, each an integer between 1 and `MAX_SPLIT_WEIGHT` (1000). Empty fields are ignored rather than counted, so `'V:1,1,'` is a two-way split.
- `parseTilingSplitToken(token)` reads a token into `{ axis, weights, repaired, discardedChildCount }`; `formatTilingSplitToken(axis, weights)` writes one back, emitting the bare axis for an even two-way split. A malformed suffix is repaired rather than rejected — `repaired` reports that the weights are a substitute, and a non-zero `discardedChildCount` means the arity itself was cut.
- **An instance id appears at most once in the tree.** An Instance is one entry in the store rendering as one tile, so a repeat describes something that cannot be rendered. Weight the split instead of repeating the leaf; the client gates call `findFirstDuplicateTilingLeaf`, while the engine's heal pass uses `findDuplicateTilingLeaves` to collect every repeat.

---

## Vessels

`VesselDefinition` is the author-facing shape — readable plain TypeScript, no brands. `validateVessel` runs the Zod parse and returns the branded `Vessel` (or a structured failure).

```ts
import { defineVessel, validateVessel } from '@maelstrom-co/protocol';

const calendar = defineVessel({
  id: 'calendar',
  name: 'Calendar',
  description: 'Shows a calendar — month or week view',
  defaultVariant: 'month',
  variants: {
    month: {
      description: 'Full-month view',
      props: {},
      minSize: { width: 4, height: 3 },
      actions: [
        {
          name: 'showWeek',
          description: 'Switch to a week view',
          transitionsTo: 'week',
        },
      ],
    },
    week: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [],
    },
  },
});

const result = validateVessel(calendar);
if (result.valid) {
  // result.vessel: Vessel  (branded — VesselId, VariantName, ActionName all in place)
} else {
  // result.issues: ValidationIssue[]
}
```

`defineVessel` is a const-preserving identity helper — it widens nothing, so downstream type-level helpers see the literal vessel shape (useful for typed action runners).

Validation enforces:

- At least one variant exists
- `defaultVariant` is a key in `variants`
- Action names are unique within a variant
- Every `transitionsTo` target resolves to an existing variant

---

## Result

A discriminated union for fallible operations. The engine returns `Result<EngineOutput, EngineError>` from `handle()` so it never throws across the contract boundary.

```ts
type Result<T, E> =
  | { ok: true;  value: T }
  | { ok: false; error: E };
```

Helpers:

```ts
import { ok, err, isOk, isErr, unwrap } from '@maelstrom-co/protocol';

const success = ok(42);
const failure = err('boom');

if (isOk(success)) success.value;   // T
if (isErr(failure)) failure.error;  // E

unwrap(success);  // T  — throws on err. Use sparingly at system boundaries.
```

---

## Wire-format schemas

Input and finalized response payloads have Zod schemas for wire-format
validation. Smart constructors enforce programmatic invariants; schemas validate
deserialized JSON. Use `EngineMessageSchema` for engine input and
`MaelstromResponseSchema` for a finalized response payload. Stream transports
use `decodeClientEnvelope` and `decodeServerEnvelope`; history uses
`SessionHistoryEntryArraySchema`.

```ts
import { EngineMessageSchema } from '@maelstrom-co/protocol';

const parsed = EngineMessageSchema.safeParse(JSON.parse(body));
if (!parsed.success) {
  // parsed.error.issues describes what went wrong
}
```

The schemas brand identifier fields via `.transform(...)`, so the parsed result carries `SessionId`, `MessageId`, `InstanceId`, etc. — no second pass needed.

---

## Drift guards

Hand-written TypeScript interfaces and Zod schemas live side-by-side. Internal compile-time checks (`_drift-guards.ts`) verify that every `z.infer<typeof Schema>` matches the corresponding hand-written interface — a wire-format change that drifts from the type contract fails to build.

This means you can:

- Trust that `z.infer<typeof ChartRequestSchema>` and `interface ChartRequest` agree
- Refactor either side and have TypeScript catch the divergence
- Author readable types without sacrificing runtime validation

A handful of fields are deliberately carved out of the drift check (the inner `TilingInstance.vesselId` / `variant` fields are typed as plain `string` in the interface but branded by the schema's transforms). Round-trip behaviour for those carve-outs is exercised in the package test suite.

---

## Errors

Direct calls return `EngineError` from `@maelstrom-co/engine`. Stream hosts
map these tags to correlated `engine.error` codes, including
`PlanningDeferredError`, `PlanningBudgetExceededError`,
`InvalidProviderResponseError`, `ProviderError`, `CancellationError`, and
`TimeoutError`. They represent failure, not a successful empty plan. See the
[planner guide](https://docs.maelstrom-ai.co/guides/engine/planner-backends/#handle-terminal-outcomes)
for operation policies and recovery choices.
