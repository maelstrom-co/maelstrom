---
editUrl: false
next: false
prev: false
title: "SectionCustomizer"
---

> **SectionCustomizer** = `string` \| [`SectionExtension`](/reference/planner-llm/type-aliases/sectionextension/) \| ((`defaultContent`) => `string`) \| `null`

Defined in: packages/planner-llm/src/lib/prompt/sections.ts:25

Customize a prompt section. Four forms:

- `string` — replace the section content entirely
- `{ prepend?, append? }` — extend without knowing the default content
- `(defaultContent) => string` — full transform (power user)
- `null` — remove the section

For new (non-default) section keys, only `string` and `{ prepend?, append? }`
are allowed. Function customizers require an existing section to transform.
