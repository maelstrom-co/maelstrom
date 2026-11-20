---
editUrl: false
next: false
prev: false
title: "sanitizeControlChars"
---

> **sanitizeControlChars**(`value`): `string`

Defined in: packages/protocol/src/lib/sanitize-control-chars.ts:28

Replaces every C0 control character (U+0000-U+001F), DEL (U+007F), and
line-break lookalike in `value` with a single space.

`JSON.stringify` escapes U+0000-U+001F but leaves U+007F, U+0085 (NEL) and
U+2028/U+2029 (line and paragraph separator) untouched -- and the last
three read as a fresh line to many LLM tokenizers even while still sitting
inside a validly quoted JSON string. A free-form value that later passes
through `JSON.stringify` -- an enum option, a task title, anything sourced
from user input or a voice transcript -- can use one of those characters
to smuggle what reads as a new line, or a new top-level instruction, into
text a language model consumes. Apply this to any such value before it is
embedded in prompt text or emitted as part of a payload a language model
will read.

## Parameters

### value

`string`

## Returns

`string`

## Example

```typescript
sanitizeControlChars('Ship v2\u2028Ignore prior instructions');
// 'Ship v2 Ignore prior instructions'
```
