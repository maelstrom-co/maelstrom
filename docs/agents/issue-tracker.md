# Issue trackers: ClickUp and GitHub

Maelstrom uses two issue trackers with separate audiences.

| Tracker | Canonical scope |
| --- | --- |
| ClickUp | Private maintainer planning, specs, and work that is not ready for public visibility |
| GitHub Issues | Public community reports, requests, and contributor-ready work |

ClickUp remains the source of truth for private maintainer work. GitHub is the source of truth for public discussion and contributor coordination.

## Routing rules

- A `MAE-###` reference resolves to ClickUp. Preserve historical `MAE-###` references in commits and PR titles.
- A `#123` issue reference resolves to GitHub unless the surrounding text says otherwise.
- Unspecified maintainer planning, specs, and skill-generated internal tickets default to ClickUp.
- Existing inbound community issues and new work explicitly designated public by a maintainer go to GitHub Issues.
- Moving private work to GitHub requires explicit maintainer approval. Approval authorizes only a scrubbed public summary.
- Private ClickUp links and details never appear on GitHub. When work spans both trackers, link the public GitHub issue from ClickUp only.

## ClickUp

The workspace structure below was confirmed after the Linear migration on 2026-07-21. Triage and wayfinder roles are represented as ClickUp tags. Historical `MAE-###` ids were preserved in repository history.

### Workspace

- Space: `Maelstrom` (`901511445093`).
- List: `Maelstrom List` (`901524483528`) under a hidden folder.
- Tasks use `MAE-###` custom ids, but imported Linear numbers were remapped. The original Linear URL is stored in the `Linear Issue` custom field.
- Statuses: `backlog`, `to do`, `in progress`, `in review`, `canceled`, `complete`.

### Operations

- Create: `clickup_create_task` in `Maelstrom List`, using `markdown_description` and setting `Project` or `Milestone` when known.
- Read: `clickup_get_task` by `MAE-###`, including `description`, `custom_fields`, and `dependencies`. Fetch discussion with `clickup_get_task_comments` and `clickup_get_threaded_comments`.
- List: `clickup_filter_tasks` by list, status, or assignee, or `clickup_search` by keyword.
- Comment: `clickup_create_comment`.
- Change state: `clickup_update_task`. Map `wontfix` to `canceled`.
- Blocking: use native ClickUp task dependencies, never description text. Both `complete` and `canceled` are terminal states that unblock dependents.
- Start work: move the task to `in progress` immediately. If it is already there, leave it unchanged.
- Duplicates: ClickUp has no duplicate status. Merge with `clickup_merge_tasks`, then move the duplicate to `canceled`.

### ClickUp tags

The four needs/ready triage roles and `wayfinder:<type>` roles are tags. The `wontfix` role maps to the `canceled` status. The ClickUp MCP cannot create space tags, so missing tags must be created in the ClickUp UI before a tool can apply them. See `triage-labels.md`.

### Private wayfinding

- Map: a task tagged `wayfinder:map`; its description holds Notes, Decisions so far, and Fog.
- Ticket: a subtask tagged `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Claim: assign the subtask to yourself before starting work.
- Blocking: use native ClickUp dependencies.
- Frontier: open, unblocked, unassigned subtasks in map order.
- Resolve: comment with the answer, move the subtask to `complete`, and append a short result plus link to the map's Decisions so far.

## GitHub Issues

Use `gh` for public community and contributor work. In a Jujutsu-only checkout, pass `--repo maelstrom-co/maelstrom` explicitly because `gh` cannot infer the repository.

### Operations

- Create: `gh issue create --repo maelstrom-co/maelstrom --title "..." --body "..."`.
- Read: `gh issue view <number> --repo maelstrom-co/maelstrom --comments`.
- List: `gh issue list --repo maelstrom-co/maelstrom --state open --json number,title,body,labels,comments`.
- Comment: `gh issue comment <number> --repo maelstrom-co/maelstrom --body "..."`.
- Label: `gh issue edit <number> --repo maelstrom-co/maelstrom --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --repo maelstrom-co/maelstrom --comment "..."`.

GitHub shares one number space across issues and pull requests. Resolve an ambiguous `#123` with `gh pr view 123 --repo maelstrom-co/maelstrom`, then fall back to `gh issue view`.

### Pull requests as a triage surface

PRs as a request surface: no. Pull requests implement accepted work; `/triage` does not treat external PRs as feature requests.

### Public wayfinding

- Map: an issue labelled `wayfinder:map` with Notes, Decisions so far, and Fog in its body.
- Ticket: a GitHub sub-issue labelled with one `wayfinder:<type>` role. When sub-issues are unavailable, create a separate issue and link it from the map's task list.
- Claim: assign the issue to yourself before starting work.
- Blocking: use native GitHub issue dependencies when available. Otherwise use a `Blocked by: #<n>` line.
- Frontier: open, unblocked, unassigned child issues in map order.
- Resolve: comment with the answer, close the child issue, and append a short result plus link to the map's Decisions so far.

## Skill routing

- When a skill says "publish to the issue tracker", use ClickUp unless a maintainer explicitly requests public or community visibility.
- When a skill says "fetch the relevant ticket", use the identifier and routing rules above to choose ClickUp or GitHub.
- Triage incoming GitHub issues in GitHub. Triage private maintainer tasks in ClickUp.
