# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to how they're represented in this repo's issue tracker (the Linear `Maelstrom`/`MAE` team).

The team has no pre-existing triage vocabulary for the four "needs/ready" roles, so they're modelled as Linear **labels** created on first use. `wontfix` maps to the existing **`Canceled` workflow state** (Linear's idiomatic "won't do"), not a label.

| Role in mattpocock/skills | Representation in our tracker           | Kind             | Meaning                                  |
| ------------------------- | --------------------------------------- | ---------------- | ---------------------------------------- |
| `needs-triage`            | `needs-triage` label                    | label            | Maintainer needs to evaluate this issue  |
| `needs-info`              | `needs-info` label                      | label            | Waiting on reporter for more information |
| `ready-for-agent`         | `ready-for-agent` label                 | label            | Fully specified, ready for an AFK agent  |
| `ready-for-human`         | `ready-for-human` label                 | label            | Requires human implementation            |
| `wontfix`                 | move issue to the `Canceled` state      | workflow state   | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), apply the corresponding Linear label — or, for `wontfix`, move the issue to `Canceled`.

## Notes

- The four triage labels don't exist yet; the first `/triage` run creates them. No duplicate risk.
- Don't confuse `wontfix` with the existing **`icebox`** label — `icebox` means "deferred / someday," not "will not action."
- Existing Maelstrom states for reference: `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`, `Duplicate`. Existing type labels: `Bug`, `Feature`, `Improvement`, `Refactor`, `enhancement`, plus area labels (`infra`, `launch`, `oss`, `voice`, `Engine`, `Library`, `Documentation`, `Company`, `icebox`).

Edit this file if you'd rather change any mapping (e.g. represent `needs-triage` as a dedicated workflow state instead of a label).
