---
editUrl: false
next: false
prev: false
title: "CommandProcessorEvents"
---

> **CommandProcessorEvents** = `object`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:40

Event map for CommandProcessor lifecycle events.

## Properties

### action\_error

> **action\_error**: `object`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:100

Fired when one or more actions in a batch fail or are skipped.

#### action

> **action**: `ActionName`

The action that failed.

#### error

> **error**: `Error` \| `undefined`

The error the action failed with, or `undefined` if it was skipped.

#### instanceId

> **instanceId**: `InstanceId`

The Instance the failing action targeted.

#### timestamp

> **timestamp**: `number`

`performance.now()` reading taken when the error was reported.

***

### action\_progress

> **action\_progress**: `object`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:42

Readiness and handler start progress, correlated to the owning command.

#### command

> **command**: [`Command`](/reference/client/type-aliases/command/)

Command that owns this readiness or execution stage.

#### progress

> **progress**: [`ActionProgress`](/reference/client/interfaces/actionprogress/)

Local Action progress.

***

### actions\_completed

> **actions\_completed**: `object`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:52

Results include successful and skipped Actions, rather than failures alone.

#### command

> **command**: [`Command`](/reference/client/type-aliases/command/)

Command whose Action plan settled.

#### result

> **result**: [`BatchExecutionResult`](/reference/client/interfaces/batchexecutionresult/)

Includes success, failure, and readiness skips.

#### timestamp

> **timestamp**: `number`

Local monotonic completion time.

***

### batch\_abandoned

> **batch\_abandoned**: `object`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:89

Fired when a command in a multi-command batch throws and the rest of
that batch is abandoned. `failed` is the command that threw (already
reported through `processing_error`); `abandoned` are the commands after
it that never ran.

#### abandoned

> **abandoned**: readonly [`Command`](/reference/client/type-aliases/command/)[]

The commands after `failed` that were never processed.

#### error

> **error**: `Error`

The error `failed` threw.

#### failed

> **failed**: [`Command`](/reference/client/type-aliases/command/)

The command that threw and stopped the batch.

#### timestamp

> **timestamp**: `number`

`performance.now()` reading taken when the batch was abandoned.

***

### command\_complete

> **command\_complete**: `object`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:66

Fired when a command finishes processing, whether it succeeded or threw.

#### command

> **command**: [`Command`](/reference/client/type-aliases/command/)

The command that finished processing.

#### duration

> **duration**: `number`

Milliseconds elapsed between `command_start` and this event.

#### timestamp

> **timestamp**: `number`

`performance.now()` reading taken when the command completed.

***

### command\_queued

> **command\_queued**: `object`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:47

Queue insertion, including work queued while another command is active.

#### command

> **command**: [`Command`](/reference/client/type-aliases/command/)

Command added to the sequential queue.

#### timestamp

> **timestamp**: `number`

Local monotonic enqueue time.

***

### command\_start

> **command\_start**: `object`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:59

Fired when a command begins processing.

#### command

> **command**: [`Command`](/reference/client/type-aliases/command/)

The command that began processing.

#### timestamp

> **timestamp**: `number`

`performance.now()` reading taken when the command started.

***

### processing\_error

> **processing\_error**: `object`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:75

Fired when a command throws while processing.

#### command

> **command**: [`Command`](/reference/client/type-aliases/command/)

The command that threw.

#### error

> **error**: `Error`

The error the command threw.

#### timestamp

> **timestamp**: `number`

`performance.now()` reading taken when the error was reported.
