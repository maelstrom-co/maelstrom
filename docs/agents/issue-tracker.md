# Issue tracker: ClickUp

Issues and specs for this repo live in **ClickUp**, not GitHub Issues. Drive ClickUp through the connected ClickUp MCP tools (`mcp__*clickup*`); load their schemas via `ToolSearch` (query `clickup`) when they aren't already available.

> **Migrated from Linear on 2026-07-21.** The workspace structure below is confirmed against the live workspace, and triage / wayfinder roles are modelled as ClickUp **tags** (decided). Historical `MAE-XXX` ids in git history / PR titles stay as-is.

## Workspace structure (confirmed)

- **One space** `Maelstrom` (`901511445093`) → **one list** `Maelstrom List` (`901524483528`); tasks sit under a `hidden` folder. Most MCP tools resolve names, so you rarely need the ids.
- **Task ids**: tasks keep a `MAE-###` **custom id** (e.g. `MAE-670`), but they were **renumbered on import** — a ClickUp `MAE-###` does **not** equal the same Linear number (no fixed offset). Each task's origin Linear id lives in a **"Linear Issue" URL custom field** (not keyword-searchable). Internal ids look like `86cav67db`; `get_task` accepts either the custom id or the internal id.
- **Statuses** (in order): `backlog` → `to do` → `in progress` → `in review` → `canceled` → `complete`.

## Conventions

- **Create an issue / spec**: `clickup_create_task` in `Maelstrom List` (`list_id: 901524483528`). Body goes in `markdown_description`; set the `Project` / `Milestone` custom fields when known.
- **Read a ticket**: `clickup_get_task` by its `MAE-###` custom id (add `include: ["description","custom_fields","dependencies"]` for full detail; `expand_statuses: true` to see assignable statuses). `get_task` returns comment *counts*, not bodies — fetch discussion separately with `clickup_get_task_comments` (and `clickup_get_threaded_comments` for replies).
- **List issues**: `clickup_filter_tasks` (by list / status / assignee) or `clickup_search` (keyword). Note `filter_tasks` cannot filter by custom-field value.
- **Comment on a ticket**: `clickup_create_comment`.
- **Apply / remove labels**: see [Labels & tags](#labels--tags) and `triage-labels.md`.
- **Change state**: `clickup_update_task` `status` between the statuses above. `wontfix` → move to **`canceled`**.
- **Blocking**: ClickUp native **task dependencies** (`clickup_add_task_dependency` / `clickup_remove_task_dependency`), never text in the description — that is the canonical, UI-visible representation. A task is unblocked when every task blocking it is in a terminal state (`complete` or `canceled`). Skills that emit tickets with dependency edges (`to-tickets`, `/wayfinder`) must write these relations.

## Labels & tags

The four triage roles and the `wayfinder:<type>` labels are ClickUp **tags** (`clickup_add_tag_to_task` / `clickup_remove_tag_from_task`).

**Creating a new tag is a manual step.** The ClickUp MCP has no space-tag creator, and `add_tag_to_task` fails on a tag that doesn't exist yet — so a tag must first be created in the ClickUp UI (Space Settings → Tags) before any tool can apply it. Don't assume `/triage` can mint its own tags. See `triage-labels.md` for the current set and their status.

## Picking up a ticket (repo rule)

When you pick up a `MAE-###` task to start work, **immediately move it to `in progress`** before doing anything else — not after planning, not after the first commit. If it's already In Progress, leave it. (This mirrors the "Issue Tracker Workflow" section in `CLAUDE.md`.)

## Pull requests as a triage surface

**PRs as a request surface: no.** Feature requests are tracked as ClickUp tasks, not inbound GitHub PRs. GitHub PRs in `maelstrom-co/maelstrom` are the implementation of a task and reference it (e.g. `(MAE-###)` in the title), but `/triage` does not pull external PRs into the queue.

## When a skill says "publish to the issue tracker"

Create a ClickUp task in `Maelstrom List`.

## When a skill says "fetch the relevant ticket"

`clickup_get_task` by its `MAE-###` custom id for the task and current status, plus `clickup_get_task_comments` for the discussion (specs/decisions often live in comments).

## Wayfinding operations

How `/wayfinder`'s map, tickets, blocking, and frontier physically live in ClickUp. The skill defines the concepts (map, ticket types, fog); this section is only the tracker-specific expression it looks up.

- **Map**: a ClickUp task in `Maelstrom List`, tagged `wayfinder:map` (create the tag first — see [Labels & tags](#labels--tags)). Its description holds the `## Notes` / `## Decisions so far` / `## Fog` sections.
- **Ticket**: a **subtask** of the map (its `parent` is the map task), description a single `## Question` section, carrying one `wayfinder:<type>` tag — `wayfinder:research` / `wayfinder:prototype` / `wayfinder:grilling` / `wayfinder:task`.
- **Claim**: **assign the subtask to yourself** before any work. The assignee *is* the claim — an open, unassigned subtask is unclaimed. Do not use a `claimed` tag.
- **Blocking**: ClickUp task **dependencies**, exactly as in [Conventions](#conventions) above.
- **Frontier**: the map's open subtasks that are unblocked and unassigned; take the first in order.
- **Resolve**: post the answer as a **comment** on the subtask, move it to `complete`, then append a one-line gist + link to the map task's `## Decisions so far`.

Refer to the map and its tickets by their **title**, not their `MAE-###` id, in anything the human reads.
