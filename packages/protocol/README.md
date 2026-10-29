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
| `RunId`        | No                  | One Agent Run                             |
| `CallId`       | No                  | One agent loop call awaiting an answer    |
| `ChangeId`     | No                  | One UI change the browser acknowledges    |

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

**`AssistantInjectionMessage`** records developer-supplied content in configured Engine history without invoking the Planner. The Engine rejects injections when history is not configured. The corresponding `assistant_message_result` output reports `outcome: 'inserted' | 'deduped'`, subject to the retention limits described under [duplex wire envelopes](#duplex-wire-envelopes).

### Smart constructors

Envelopes are constructed via factories that share their name with their type (the identifier doubles as type and value, exploiting TypeScript's separate namespaces). The factory fills in `id` (Nano ID) and `timestamp` (`Date.now()`) unless you pass them.

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

### Duplex wire envelopes

The duplex transport exchanges `ClientEnvelope` and `ServerEnvelope` values. Chart requests and assistant injections use these wire shapes (`?` marks an optional field):

```text
AcknowledgedAssistantMessage {
  type: 'client.assistant_message.acknowledged';
  id: MessageId;
  sessionId: SessionId;
  timestamp: number;
  content: string;
}

AssistantMessageResultMessage {
  type: 'engine.assistant_message.result';
  requestId: MessageId;
  sessionId: SessionId;
  outcome: 'inserted' | 'deduped';
}

MaelstromResponseMessage {
  type: 'engine.maelstrom.response';
  requestId: MessageId;
  sessionId?: SessionId;
  response: MaelstromResponse;
}

EngineErrorMessage {
  type: 'engine.error';
  requestId?: MessageId;
  sessionId?: SessionId;
  error: string;
  code?: string;
}
```

`AcknowledgedAssistantMessage()` constructs an injection that requests a receipt. It generates `id` and defaults `timestamp` to `Date.now()` when omitted. The constructor rejects empty or whitespace-only IDs, empty content, and non-finite timestamps.

Both injection variants require configured Engine history. Without it, the Engine rejects the injection and records no content. For a valid legacy `assistant_message`, `handleEnvelope` suppresses Engine failures and returns no reply. Use acknowledged injections when callers need failure responses.

The Engine host maps the acknowledged request to an assistant injection. On success, it returns `engine.assistant_message.result`, with the request's `id` in `requestId` and the same `sessionId`. Failure produces a correlated `engine.error`.

An `inserted` outcome means the store accepted the append. History limits may immediately remove that entry, so replaying its ID can return `inserted` again. A `deduped` outcome means the store found an entry with that ID in the session. The protocol does not guarantee permanent deduplication.

A successful `chart_request` produces `engine.maelstrom.response`; failure produces `engine.error`. The response's `requestId` echoes the input's `id`. Errors can omit `requestId` when the host cannot recover it from the incoming frame. Clients must accept absent or unknown error codes and use `error` as the display message.

The Engine's `handleEnvelope` adapter decodes an incoming frame and resolves to a `ServerEnvelope` or `null`. The host encodes each non-null reply with `encodeEnvelope` before sending it. Clients decode replies with `decodeServerEnvelope`.

### Agent wire frames

The agent wire travels inside two wrapper frames. `client.agent.input` (`AgentInputMessage`) carries one `AgentInput` under `input`, and `engine.agent.event` (`AgentEventMessage`) carries one `AgentEvent` under `event`. Both frames carry `id` and `sessionId` and decode through `decodeClientEnvelope` / `decodeServerEnvelope`.

```ts
type AgentInput =
  | { type: 'utterance'; version: 1; inputId: MessageId; text: string; chart: ChartRequest; source: 'text' | 'voice' }
  | { type: 'ui_applied'; version: 1; changeId: ChangeId; chart: ChartRequest; actionOutcomes: AgentActionOutcome[] };

type AgentEvent =
  | { type: 'placeholder'; version: 1; inputId: MessageId; text: string }
  | { type: 'accepted'; version: 1; inputId: MessageId; runId: RunId | null; disposition: AgentDisposition; ack: string }
  | { type: 'message'; version: 1; runId: RunId; turnId: string; delta: string }
  | { type: 'ui_change'; version: 1; runId: RunId | null; changeId: ChangeId; response: MaelstromResponse }
  | { type: 'finished'; version: 1; runId: RunId; ok: boolean; reason: AgentFinishReason; reply: string; metrics: AgentRunMetrics; error?: string; code?: string }
  | { type: 'error'; version: 1; inputId?: MessageId; changeId?: ChangeId; error: string; code?: string };
```

`AgentInputMessage()` and `AgentEventMessage()` are smart constructors like the other frames, but they default only `id` (agent frames carry no `timestamp`):

```ts
const frame = AgentInputMessage({ sessionId, input: utterance });
ws.send(encodeEnvelope(frame));
```

Every member carries `version` equal to `AGENT_WIRE_VERSION` (currently 1). A new optional field keeps the version because decoders strip unknown keys. A new member or enum value is rejected by an older decoder as an `invalid_envelope` `EnvelopeError`, as is any other `version` value, so such a change bumps the version. `CallId` is deliberately distinct from `ToolCallId`: provider tool call ids and agent loop call ids are separate id spaces.

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
  skipReply?: boolean;
  intentFacts?: Readonly<Record<string, JsonValue>>;
}
```

Identity (`id`), session binding (`sessionId`), and timestamp live on the surrounding envelope, not in this payload.

### skipReply and intent facts

Both fields are optional and absent by default. A client that renders the Planner's reply leaves them unset. They are for a caller that owns the conversation itself, such as an agent loop.

- **`skipReply`** (default `false`): the caller writes what the user reads and hears, so the Planner may omit `userMessage` or answer with a `NeedsClarification` result instead of a layout. See [Planner output](#planner-output).
- **`intentFacts`**: structured values the caller already learned about the intent, for example from tool results, keyed by a name the Planner can reason about. They are inputs to planning, not instructions. The Planner still chooses the Actions and their parameters. Every value must be a `JsonValue`, and `ChartRequestSchema` rejects anything JSON cannot carry, such as a function or an `undefined` property.

```ts
const request: ChartRequest = {
  ...baseRequest,
  skipReply: true,
  intentFacts: { latestOrderSku: 'A123', similarSkus: ['B456'] },
};
```

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

Each vessel instance that is currently mounted is represented by a snapshot:

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

`MaelstromResponse` always carries `userMessage`, whatever the request's `skipReply` flag.

---

## Planner output

`GridResponseSchema` and `TilingResponseSchema` describe the structured output a Planner returns for a request without `skipReply`. Both require `userMessage`.

For a request with `skipReply: true` the Planner may return one of these instead:

- **`GridResponseWithoutReplySchema` / `TilingResponseWithoutReplySchema`**: the same shapes with an optional `userMessage`. The strict schemas stay unchanged.
- **`NeedsClarificationSchema`**: a question for the user when the Planner cannot proceed without one. It carries no layout and no execution plan.

```ts
interface NeedsClarification {
  type: 'needs_clarification';
  question: string;            // never blank
  options?: readonly string[]; // suggested answers, each non-blank
}
```

`PlannerOutputFor<R>` turns that rule into a type. For a request type whose `skipReply` is absent or `false` it is the reply-bearing `GridResponse | TilingResponse`. For `skipReply: true`, or a flag only known as `boolean`, it is `GridResponseWithoutReply | TilingResponseWithoutReply | NeedsClarification`.

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

Every input payload has a Zod schema for wire-format validation. Smart constructors enforce invariants for programmatic construction; schemas are the equivalent guarantee for deserialised JSON. Use `safeParse` at any boundary that ingests bytes. Engine outputs are constructed in-process and don't ship with parsers — consumers receive them through the engine `handle()` Result, never off the wire.

```ts
import { EngineMessageSchema } from '@maelstrom-co/protocol';

const parsed = EngineMessageSchema.safeParse(JSON.parse(body));
if (!parsed.success) {
  // parsed.error.issues describes what went wrong
}
```

The schemas brand identifier fields via `.transform(...)`, so the parsed result carries `SessionId`, `MessageId`, `InstanceId`, etc. — no second pass needed.

`JsonValueSchema` validates a `JsonValue`: a string, finite number, boolean, `null`, or an array or plain object of those, at any depth.

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
