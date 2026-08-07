# Triage Labels

The skills use five canonical triage roles. Their representation depends on the issue's tracker.

| Role | GitHub Issues | ClickUp | Meaning |
| --- | --- | --- | --- |
| `needs-triage` | `needs-triage` label | `needs-triage` tag | Maintainer needs to evaluate the issue |
| `needs-info` | `needs-info` label | `needs-info` tag | Waiting for more information |
| `ready-for-agent` | `ready-for-agent` label | `ready-for-agent` tag | Fully specified and ready for an unattended agent |
| `ready-for-human` | `ready-for-human` label | `ready-for-human` tag | Requires human implementation |
| `wontfix` | `wontfix` label | `canceled` status | Will not be actioned |

Apply the representation for the tracker's canonical scope. Private ClickUp tags and context never belong in a public GitHub issue. Maintainer approval authorizes only a scrubbed public summary.

ClickUp tags must exist in the Space before the MCP can apply them. Create missing ClickUp tags manually in Space Settings. GitHub labels can be managed with `gh label`.
