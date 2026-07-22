# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to how they're represented in this repo's ClickUp workspace (`Maelstrom` space → `Maelstrom List`).

The four "needs/ready" roles are ClickUp **tags**; `wontfix` maps to the **`canceled`** status (ClickUp's idiomatic "won't do"), not a tag.

| Role in mattpocock/skills | Representation in our tracker            | Kind    | Meaning                                  |
| ------------------------- | ---------------------------------------- | ------- | ---------------------------------------- |
| `needs-triage`            | `needs-triage` tag                       | tag     | Maintainer needs to evaluate this issue  |
| `needs-info`              | `needs-info` tag                         | tag     | Waiting on reporter for more information |
| `ready-for-agent`         | `ready-for-agent` tag                    | tag     | Fully specified, ready for an AFK agent  |
| `ready-for-human`         | `ready-for-human` tag                    | tag     | Requires human implementation            |
| `wontfix`                 | move task to the `canceled` status       | status  | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), apply the corresponding ClickUp tag — or, for `wontfix`, move the task to `canceled`.

## Notes

- **The four tags must be created in the ClickUp UI first** (Space Settings → Tags in the `Maelstrom` space). The MCP has no space-tag creator and `clickup_add_tag_to_task` fails on a non-existent tag, so `/triage` cannot mint them itself — creating the four is a one-time manual setup step. *(Status as of 2026-07-22: not yet created.)*
- Confirmed list statuses: `backlog`, `to do`, `in progress`, `in review`, `canceled`, `complete`. (There is no separate `Duplicate` status — merge duplicates via `clickup_merge_tasks` and close as `canceled`.)
- Existing ClickUp custom fields for reference: `Project`, `Milestone`, `Parent issue`, `Linear Issue` (origin id), `Creator`.
