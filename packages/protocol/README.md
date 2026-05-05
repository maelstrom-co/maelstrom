# @maelstrom-co/protocol

Shared types, Zod schemas, and message envelopes for Maelstrom. Both the engine and everything that talks to it import from this package — the protocol is the contract that survives implementation changes.

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
| `SessionId`    | `session-<UUID>`    | One conversation                          |
| `MessageId`    | UUID                | One envelope                              |
| `InstanceId`   | No                  | One mounted vessel on the chart           |
| `VesselId`     | No                  | A registered vessel type                  |
| `VariantName`  | No                  | A state within a vessel                   |
| `ActionName`   | No                  | A transition exposed by a variant         |

```ts
import { SessionId, VesselId, MessageId } from '@maelstrom-co/protocol';

const session = SessionId();             // auto-generated, e.g. session-<uuid>
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
  userMessage: string;
  rationale: string;
  executionPlan: readonly ActionExecution[];
  layout: GridLayout | TilingLayout;
}

interface ActionExecution {
  instanceId: InstanceId;
  action: string;
  params?: Record<string, unknown>;
}
```

`requestId` echoes the originating envelope `id` so callers can correlate without external bookkeeping. `executionPlan` lists action invocations to apply (in order) before the layout transition. `userMessage` is the natural-language summary the LLM produced for end users; `rationale` is the LLM's internal reasoning, useful for logging and debugging.

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

A binary tree of horizontal / vertical splits with instance leaves, expressed as a preorder array.

```ts
interface TilingLayout {
  type: 'tiling';
  tree: readonly TilingNode[];      // 'H' | 'V' | InstanceId | null
  instances: readonly TilingInstance[];
}

interface TilingInstance {
  instanceId: InstanceId;
  vesselId: string;
  variant: string;
}
```

The wire shape `'H' | 'V' | string | null` makes `InstanceId` structurally indistinguishable from the split operators at the value level. Use the predicates instead of hand-rolled discrimination:

```ts
import { isInstanceIdNode, isTilingSplit } from '@maelstrom-co/protocol';

for (const node of layout.tree) {
  if (isTilingSplit(node)) { /* 'H' or 'V' */ }
  else if (isInstanceIdNode(node)) { /* an InstanceId leaf */ }
  else { /* null — empty subtree */ }
}
```

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

Every input payload has a Zod schema for wire-format validation. Smart constructors enforce invariants for programmatic construction; schemas are the equivalent guarantee for deserialised JSON. Use `safeParse` at any boundary that ingests bytes. Engine outputs are constructed in-process and don't ship with parsers — consumers receive them through the engine `handle()` Result, never off the wire.

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

A protocol-level error catalogue is deferred to a follow-up cut. For now, `Result.error` from the engine surfaces as `EngineError` (defined in `@maelstrom-co/engine`).
