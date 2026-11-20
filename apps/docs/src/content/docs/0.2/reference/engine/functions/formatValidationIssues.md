---
editUrl: false
next: false
prev: false
title: "formatValidationIssues"
---

> **formatValidationIssues**(`error`): `string`

Defined in: packages/engine/src/lib/validation/format-validation-issues.ts:15

Renders every issue of a Zod validation error as one line, for the
message of an error thrown when caller-supplied options fail validation.

Issues are joined with `; `. Each reads `path [code]: message`, with
`(root)` standing in for an empty path. A union issue appends its failed
branches in parentheses, separated by ` | `; nested issues within a
branch or a container issue are joined with ` & `.

## Parameters

### error

`ZodError`

The error from a failed `safeParse` or `parse`.

## Returns

`string`

The formatted issues, never empty for a non-empty issue list.
