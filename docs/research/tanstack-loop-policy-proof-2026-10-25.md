# TanStack loop mechanics do not replace application policy

This evidence note is for maintainers preparing a bounded model/tool loop.
It supplements the [alignment research][research], not the earlier nine-test
characterization. The earlier artifact was unavailable in this checkout and was
not rerun. The installed core and OpenAI adapter versions are 1.0.0; Bun is 1.4.3.

The [15-case suite][suite] runs the real public `chat`, `toolDefinition`,
middleware, and `fakeText` APIs with Maelstrom's existing [usage wrapper][usage].
Each case runs in a child process, outside other tests' module mocks.
The [fixture][fixture] rejects `fetch` and `fetch.preconnect` calls and checks
that neither ran. It requires no credentials or provider requests.

## What the composed proof establishes

| Boundary | Observed result | Integration consequence |
| --- | --- | --- |
| Authorization before caching | An authorized call warms the cache. An unauthorized principal receives no cached result when authorization precedes the cache. | Put authorization before any shortcut that can disclose a result. |
| Guard-only authorization | A real cache hit bypasses `onGuardToolCall`, even when that guard appears first in the middleware array. | A guard alone cannot authorize cached disclosure. Current Maelstrom does not enable this cache. |
| Cache scope and freshness | Principal and revision keys isolate identical calls. Expiry causes a fresh read. An explicit read-only list leaves mutations uncached. | Scoped keys, expiry, and tool selection are separate requirements, not defaults supplied by a thread ID. |
| Input and result validation | Transformed arguments reach the guard. Before-hook `skip` and after-hook `replaceResult` can return values rejected by the tool's output schema. | Validate substituted results separately. Executor output validation does not cover these paths. |
| Tool turns | Two provider calls report 12 and 5 tokens. The wrapper records 17; `onFinish` reports only the final 5. | Sum provider-call records. Do not add final-turn usage again. |
| Structured finalization | Two model turns plus direct structured finalization report 12, 5, and 3 tokens. The wrapper records 20; terminal loop usage remains 5. | Count finalization as another provider call. Existing suites cover the other structured-output paths. |
| Failed turns | A tool turn followed by a failed provider call retains both reported token counts: 12 and 7. | Failed work can still consume reported usage. |
| Concurrency and presence | Concurrent wrappers over one scripted adapter keep roles separate. Missing usage stays absent; explicit zeros stay zero. | Do not convert unknown accounting into free work. |
| Initial admission | Initial middleware aborts a zero-budget invocation before model or tool work. A positive-budget control executes. | Admission needs a separate policy; `maxIterations(0)` alone is not one. |
| Batch limits and mutation order | Three requested increments produce only two mutations. Sequential execution preserves balances 1 then 3. | Reserve tool capacity before dispatch and serialize dependent mutations. |
| Usage before tools | A guard blocks already-emitted tools after exhausted or unknown usage. A within-budget control executes. | Stopping the next model turn alone does not protect the current tool phase. |
| Cancellation delivery | Abort reaches the tool and prevents another model turn. A non-cooperative executor still commits its fixture effect. | Cancellation cannot undo an external write or force arbitrary JavaScript to stop. |
| Rate-limit retries | One model iteration makes two provider attempts. The wrapper retains both token counts, 2 and 5; `onUsage` sees only the retained successful attempt's 5. | Budget and account for provider attempts, not only model iterations or core usage hooks. |
| Deadline boundary | With a deterministic monotonic clock, a tool starts at 99 milliseconds but not at the 100-millisecond deadline or after it. | Check deadlines before side effects. This does not prove an in-flight provider deadline timer. |
| Cumulative token guard | Two turns each report 6 tokens. A 10-token policy admits the first mutation and rejects the second. | Guard against the whole call ledger, not only the latest turn's usage. |

The authorization case also observes an abort hook without a `RUN_FINISHED` or
`RUN_ERROR` chunk for that invocation. Maelstrom must emit its own terminal
outcome; it cannot assume every SDK abort produces a wire terminal event.
This observation concerns an explicit middleware abort in this release, not all
possible cancellation paths.

## Policies demonstrated, not production guarantees

The policy callbacks live only in the offline fixture. They do not implement
production authorization, cache policy, budgets, or cancellation in the Engine.
The unsafe cache case deliberately demonstrates a configuration that must not
ship. No runtime cache or transport was enabled or replaced.

Production integration still needs connection-owned admission, identity and
transcript rules, cumulative budgets across continuations, sanitized errors, and
exactly one application terminal outcome. It must reject late publication from
retired runs. UI completion must still follow the matching browser
acknowledgement and layout-before-Actions application order.

The token guard stops tools after reported usage. It is not a hard prepaid token
ceiling. Provider SDK retries can add attempts below the adapter boundary; this
suite characterizes core retries, not hidden provider SDK work. The deadline
guard and manual abort do not prove a deployed host's timer or shutdown behavior.

Stored waits, client approvals, persistence, general continuation inputs, and
AG-UI adoption remain separate decisions. The source-level adapter parity and
provider prompt-cache audit also remains separate. This work changes no Engine,
protocol, demo-host, pet-shop, dependency, or usage-wrapper implementation file.

## Regression sensitivity

The first authorization check failed with caching placed before authorization:
the second principal received the first principal's fixture. Moving authorization
first made the check pass.

Inverting the batch reservation guard from `> 2` to `< 2` made the mutation check
fail: balances became 2 and 102 instead of 1 and 3. The guard was restored before
verification. These failures exercise observed tool effects, not just configured
options or counters.

## Reproduce the evidence

From this checkout's workspace root, install its frozen lockfile and run the
focused suite:

```sh
bun install --frozen-lockfile
bun test --conditions=@maelstrom-co/source packages/evals/src/eval/tanstack-loop-policy.test.ts
```

Expected result: 15 scenarios pass. The outer runner checks child exit status and
output; the fixture checks the model requests, stream results, usage records,
authorization decisions, and actual tool effects.

Full affected verification uses the configured targets without Nx cache:

```sh
NX_NO_CLOUD=true NX_DAEMON=false bunx nx run-many \
  -t typecheck,test,check -p @maelstrom-co/evals @maelstrom-co/source \
  --skip-nx-cache --output-style=static
```

The final uncached run passed typecheck, tests, and Biome for both projects and
22 prerequisite tasks. Tests passed: 365 eval, 513 script, and 225 Actions tests.
Nx reported flaky-task warnings for the protocol and LiveKit-agent builds;
both builds passed. Full documentation lint passed with Vale 3.18.0, zero errors,
and one existing protocol warning. Supplemental Markdownlint passed with the
line-length rule disabled for the evidence table. Terminal Markdown rendering
was inspected; this note is not a documentation-site page.

The source findings that motivate these checks are release-pinned in the
alignment research. In particular, inspect the [middleware composition][compose],
[tool dispatch][tools], and [retry and terminal lifecycle][chat] before changing
the policy configuration. No latency, cost saving, live provider behavior, or
production recovery claim follows from this synthetic suite.

[research]: https://github.com/maelstrom-co/maelstrom/blob/f3829d4f75ce8cb1cc37cfa3e2f6b6937bd6f604/docs/research/tanstack-ai-alignment-2026-10-25.md
[suite]: ../../packages/evals/src/eval/tanstack-loop-policy.test.ts
[fixture]: ../../packages/evals/src/eval/__fixtures__/tanstack-loop-policy.ts
[usage]: ../../packages/evals/src/core/usage-adapter.ts
[compose]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/middleware/compose.ts
[tools]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/tools/tool-calls.ts
[chat]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/index.ts
