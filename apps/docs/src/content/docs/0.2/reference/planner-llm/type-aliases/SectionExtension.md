---
editUrl: false
next: false
prev: false
title: "SectionExtension"
---

> **SectionExtension** = \{ `append?`: `string`; `prepend`: `string`; \} \| \{ `append`: `string`; `prepend?`: `string`; \}

Defined in: packages/planner-llm/src/lib/prompt/sections.ts:36

Prepend and/or append content. For an existing default section, the content
wraps its default text; for a new custom key, `prepend` and `append` are
joined directly.
