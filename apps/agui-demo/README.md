# AG-UI demo compatibility

This app connects TanStack AI goals to the Calendar, Weather, Journal, Tasks,
Map, and Labs [Vessels](../../docs/architecture.md). Typed input and GPT-Live
share one app-owned goal runner. The app owns authorization, records, receipts,
and recovery.

The integration remains experimental. Its three AG-UI packages are public SDK
packages with an experimental API contract. The Cloudflare resources and deployment workflows are
configured; deployed live-provider and recovery verification remain release gates.

## Supported configuration

| Component | Version or identity | Role |
| --- | --- | --- |
| `@tanstack/ai` | `1.0.0` | Goal planning, authorized read tools, and frontend-tool continuation |
| `@tanstack/ai-openai` | `1.0.0` | OpenAI text adapter |
| `@ag-ui/core` | `1.0.0` | Outer goal events and schemas |
| `@maelstrom-co/agui`, `agui-server`, `agui-protocol` | `0.2.1`, experimental, built from this checkout | Inner workspace plan and acknowledgment exchange |
| Maelstrom client, Engine, protocol, and React packages | `0.2.1`, built from this checkout | UI planning, application, and settlement |
| Goal and Engine model | `gpt-5.4-mini` | Separate goal and UI planning calls |
| Voice model | `gpt-live-1`, managed backend `gpt-6-luna` | Speech and delegation to the shared goal runner |
| Local durable runtime | Miniflare `5.20261012.0-beta` | The Worker and SQLite Durable Objects |
| Cloudflare compatibility | `2026-07-22`, `nodejs_compat` | Hosted runtime configuration |

The SDK artifacts include local changes beyond the published `0.2.1`
release. Installing that release alone does not reproduce this checkout.
Other agent runtimes, AG-UI versions, and provider adapters have no compatibility
claim from this example.

## Runtime boundaries

The outer `/api/goal` stream uses TanStack AI frontend-tool continuation.
`read_workspace` returns authorized records, exact IDs and versions, fixed Map
reference data, and the last accepted UI observation.

`apply_workspace` requests one UI application. The browser waits for its
Orchestrator ticket and canonical settlement before returning the tool result.
The server verifies the issued call and enriches its result with authoritative
workspace evidence before allowing continuation. Browser-supplied history must
match the server-owned history.

The inner `/api/workspace/exchange` transport uses `AguiWorkspaceClient` and
`AguiWorkspaceSession`. Its custom `demo.agui.run` plan and acknowledgment runs
follow the [workspace wire contract](../../packages/agui-protocol/CONTRACT.md).
They are Maelstrom-specific operations with their own session identities. They do not define
general AG-UI mid-run input semantics. Compatibility requires both the outer
continuation interface and this inner application contract.

Each plan allows one application-effect Action plus supported view-only Actions.
Dependent writes require successive continuations. Automatic Chart resize
requests cannot perform application effects or complete a pending frontend tool.
Layout application precedes Action execution. Retained hidden Instances keep
their Action handlers until removal or replacement.
The response Layout declares pre-action Variants. Successful Actions apply
their transitions afterward, and continuation observes the settled Variants.

## Completion evidence

| Result | Meaning | Continuation |
| --- | --- | --- |
| Application `applied` | The matching Layout and Actions settled and their evidence was accepted | The goal runtime may inspect the result and plan another step |
| Goal `completed` | Every declared mutation passed verification, and the goal model reports the work complete or answers an authorized read | A new goal may start |
| Goal `incomplete` | Some requested work remains unavailable or needs clarification | A new goal may start; earlier confirmed writes remain saved |
| Goal `unknown` | Transport or application uncertainty prevents confirmation | The binding stops and requires explicit reconciliation |

A visible Chart establishes structure and variants. It does not prove loaded
weather values, Map tiles, or a durable business write. This app proves writes
with server-owned records and receipts. A factual read-only goal needs no UI
application.

Each `apply_workspace` call declares `expectedMutation`: one exact record command,
or `null` when no records should change. Before continuation, the server compares
that declaration with the accepted plan's command and committed receipt.
An empty plan cannot satisfy a declared write. A mismatch ends the goal as
`incomplete` before another model call. The result preserves the Engine message
and actual command evidence. Missing receipt evidence remains `unknown`.

The goal model still interprets the request and checks requested views. Command
verification does not independently prove that it included every requested step.

The server commits each record mutation and its receipt in one SQLite
transaction. It checks the exact issued plan, ordered Action index, binding,
and target version. An exact duplicate operation returns its saved receipt.
An unconfirmed operation cannot execute after recovery. This guarantee applies
to this app's data store; consumers must define equivalent guarantees for their
own application effects.

## Workspace recovery

A routing cookie selects one Durable Object. A separate authorization cookie
controls access. Same-origin checks and the active browser binding also apply.
Workspace access requires the same browser's cookies; there are no accounts or
cross-device recovery.

Reload, runtime restart, or an uncertain result requires inspection of saved
records and operation receipts. **Reconcile and continue** creates fresh
protocol sessions. It preserves committed records and receipts without replaying
old writes. It does not restore the prior conversation or visible Layout.
The new binding rejects requests from the retired binding, including another tab.

Journal entries, Tasks and subtasks, dated Calendar events, issued plans,
receipts, and accepted application evidence persist for seven days after last
use. **Reset workspace** deletes the records, receipts, authorization, and
binding history. Provider keys stay in memory and require re-entry after reload.

## Vessel data

| Vessel | Data owner | Limit |
| --- | --- | --- |
| Journal | Authorized workspace | Entries start empty; dependent updates use observed IDs and versions |
| Tasks | Authorized workspace | Tasks and subtasks start empty; ambiguous title matches are rejected |
| Calendar | Authorized workspace | Events need an absolute date, local time, and IANA timezone |
| Weather | App-owned loading | External data may be unavailable; an applied view does not prove loaded values |
| Map | Fixed demo places and app-owned route loading | Four reference locations; route and tile availability are separate from settlement |
| Labs | Demo labels | No medical measurements |

## Local and hosted targets

Repository setup follows [Contributing](../../CONTRIBUTING.md#getting-started).
These commands run from the repository root after dependency installation.

| Command | Target | Observable result |
| --- | --- | --- |
| `bunx nx run @maelstrom-co/agui-demo:build-hosted --skip-nx-cache` | Browser build | `apps/agui-demo/dist/client` |
| `bun run --cwd apps/agui-demo dev:durable` | Persistent local Worker, after the browser build | `http://127.0.0.1:4311`, with `Durable · 7 days` after opening |
| `bun run --cwd apps/agui-demo preview` | Bun host, after the browser build | In-memory records; process exit loses them |

Both local hosts accept `AGUI_PORT`. The durable runner also accepts
`AGUI_STORAGE`. Its default storage
directory is `apps/agui-demo/.wrangler/state/agui`. Changing the origin or
deleting that directory prevents access to the prior local workspace.

Production uses Worker `maelstrom-agui`, stack `MaelstromAgui`, and configured
domain `agui.maelstrom-ai.co`. Preview stack `MaelstromAguiPreview` creates
`maelstrom-agui-alchemy-pr-<number>` in the preview account.
The [preview lifecycle](../../CONTRIBUTING.md#preview-the-applications) publishes its validated
URL and removes the stack during teardown.

The original home demo uses its native path. Its historical AG-UI integrations
remain documented in the [archived integration guide](../demo/AGUI.md).
