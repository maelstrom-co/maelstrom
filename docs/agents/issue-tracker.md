# Issue tracker: Linear

Issues and PRDs for this repo live in **Linear**, not GitHub Issues. Tickets are identified as `MAE-XXX` (team key `MAE`). Drive Linear through the connected Linear MCP tools (`mcp__*_linear__*` / `mcp__*_Linear__*`); load their schemas via `ToolSearch` (query `linear`) when they aren't already available.

## Conventions

- **Create an issue / PRD**: create a Linear issue on the `MAE` team. Put the spec in the description; use the relevant project (e.g. the current release project) when known.
- **Read a ticket**: fetch the Linear issue by its `MAE-XXX` identifier, including comments and its current workflow state.
- **List issues**: query Linear filtered by team `MAE`, state, and/or label.
- **Comment on a ticket**: add a Linear comment to `MAE-XXX`.
- **Apply / remove labels**: edit the Linear issue's labels (see `triage-labels.md` for the role → label mapping).
- **Change state**: move the issue between workflow states (Backlog → Todo → In Progress → In Review → Done, or the team's actual states).

## Picking up a ticket (repo rule)

When you pick up a `MAE-XXX` ticket to start work, **immediately move it to "In Progress"** before doing anything else — not after planning, not after the first commit. If it's already In Progress, leave it. (This mirrors the "Linear Workflow" section in `CLAUDE.md`.)

## Pull requests as a triage surface

**PRs as a request surface: no.** Feature requests are tracked as Linear tickets, not inbound GitHub PRs. GitHub PRs in `maelstrom-co/maelstrom` are the implementation of a ticket and reference it (e.g. `(MAE-XXX)` in the title), but `/triage` does not pull external PRs into the queue.

## When a skill says "publish to the issue tracker"

Create a Linear issue on the `MAE` team.

## When a skill says "fetch the relevant ticket"

Fetch the Linear issue by its `MAE-XXX` identifier (with comments and current state).

## Wayfinding operations

How `/wayfinder`'s map, tickets, blocking, and frontier physically live on Linear. The skill defines the concepts (map, ticket types, fog); this section is only the tracker-specific expression it looks up.

- **Map**: a Linear issue on the `MAE` team, labelled `wayfinder:map`. Its body holds the `## Notes` / `## Decisions so far` / `## Fog` sections.
- **Ticket**: a Linear **sub-issue** of the map (its parent is the map issue), body a single `## Question` section, carrying one `wayfinder:<type>` label — `wayfinder:research` / `wayfinder:prototype` / `wayfinder:grilling` / `wayfinder:task`. These labels are created on first use.
- **Claim**: **assign the sub-issue to yourself** (the dev driving the map) before any work. The assignee *is* the claim — an open, unassigned sub-issue is unclaimed. Do not use a `claimed` label.
- **Blocking**: use Linear's native **blocked-by** relation, so the frontier renders in Linear's own UI. A ticket is unblocked when every issue blocking it is closed — any terminal state (`Done`, `Canceled`, or `Duplicate`).
- **Frontier**: the map's open sub-issues that are unblocked and unassigned; take the first in order.
- **Resolve**: post the answer as a **comment** on the sub-issue, move it to `Done`, then append a one-line gist + link to the map issue's `## Decisions so far`.

Refer to the map and its tickets by their **title**, not their `MAE-XXX` id, in anything the human reads.
