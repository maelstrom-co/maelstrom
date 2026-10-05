# Pull request walkthroughs

These review artifacts describe pinned pull-request revisions. They live on a
separate branch and do not change either implementation diff.

- PR 249: [A clearer first task](pr-249.md) · [self-contained HTML](pr-249.html).
  Source: `64db87970db40c2120989bf34d5ab374c4790299`.
- PR 250: [Evidence before comparison](pr-250.md) · [self-contained HTML](pr-250.html).
  Source: `e132b850d9eb3997a4c1cf8529efb69424c51780`.

GitHub renders the Markdown versions directly. Download an HTML file and open it
locally for syntax highlighting, diagrams, and the light/dark theme toggle.
The HTML needs no public hosting and includes no audio track.

The adjacent manifests contain the authored text and structured code/diagram
entries. The `pr-walkthrough` build script creates the initial HTML. Rendered
light/dark SVG diagrams replace the client-side diagram library in the final
downloads, so opening a local file needs no library load or external request.
Both versions explain the same source revision; neither is a benchmark result
or merge approval.
