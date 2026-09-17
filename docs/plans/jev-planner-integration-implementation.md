# Planner integration implementation record

All six phases of the [approved plan](./jev-planner-integration.md) are implemented.
The LLM remains the default. Jev is an experimental server-side option.

This record identifies the delivered changes and verification evidence for maintainers.
It does not establish comparative model quality or approve Jev promotion.

## Delivered changes

| Phase | Commit | Result |
| --- | --- | --- |
| Shared operation | `dc8e3ac8` | Public planner invocation, engine-owned finalization, repair, fallback, cancellation, deadlines, and logical call budgets. |
| Text-free plans | `c26d7de2` | Optional presentation text, shared response decoding, structured history, and independent retention budgets. |
| Jev package | `5b5769e0` | Server-only staged Choice planning, code-owned candidates, deterministic resize, and semantic capability deferrals. |
| Local demo | `6c96fd7d` | Validated local selection, server credentials, optional LLM fallback, keyless Jev profile, and hosted BYOK isolation. |
| Public documentation | `0d690ab1` | Four compiling configurations, migration guidance, operational contracts, and generated reference coverage. |
| Offline evaluation | `26594e06` | Shared scripted evaluation, semantic scoring, promotion criteria, and final review corrections. |

The implementation starts after planning revision `35c6f71e`.
The Apnea implementation run is `56d35e3c-c40b-433f-b395-3516fb63ff53`.

The [planner guide](../../apps/docs/src/content/docs/guides/engine/planner-backends.mdx)
documents configuration and migration.
The [evaluation reference](../planner-evaluation.md) defines report fields and promotion requirements.

## Final review

### Standards

Passed with no unresolved documented-standard violations.
Review restored the Engine's deduplication, concurrency, cancellation, and history-error contracts.
It also documented synchronous planner construction failures.

One optional maintenance suggestion remains: consolidate the duplicate internal deep-freeze helpers.
The review classified this as nonblocking.

### Spec

Passed with no unresolved substantive requirements findings.
Strict finalization now validates actions against the actual post-layout instance state in both layout modes.
Tiling retains declared hidden instances; grid retains positioned instances.
Legacy adapter routes preserve their request-first compatibility behavior.

Regression tests also preserve legacy per-action parameter-limit handling.
Oversized parameter values skip that action without discarding a valid layout or valid sibling actions.
Strict routes reject the invalid complete plan.

## Verification

The final source revision passed these checks with Nx cache disabled:

- Type-check, test, and Biome targets for all 12 projects named in the plan.
- Root and realtime-protocol targets, including package-layer boundaries.
- Build targets for the same affected project set.
- The explicit `engine-jev:evaluate-offline` target.
- Documentation lint with Vale 3.18.0: zero errors; warning-level findings remain.
- Declaration and packed-consumer audits: zero findings.
- Generated TypeDoc audit: zero findings.

The final run used `--parallel=2`.
A prior registry test timed out under higher load; its focused rerun and the final full target passed.
The final documentation build includes the evaluator README link correction.

### Browser and documentation rendering

Real Chromium testing used an isolated context and scripted server-side Jev responses.
The local demo connected without a browser-key handshake or key drawer.
A text-free hide-all plan changed the Chart and returned controls to idle without an assistant card.
A deliberate unsupported request displayed a deferral error and left the layout unchanged.
The successful path had no browser console errors.
The deliberate failure logged its expected request error.

The documentation check compiled all four configuration examples and the optional-text migration example.
It checked 45 public reference symbols and 122 documented members.
Ten built documentation pages rendered with working internal links and no console errors.

### Offline evaluation

The evaluator ran 28 shared cases through both real planner implementations: 56 outcomes, zero regressions, and zero live calls.
Its negative probes deliberately include schema-valid incorrect layouts, actions, and parameters.
Those outcomes remain visible in the report and do not count as evaluator regressions.

Timings measure local test overhead. Model identifiers and usage values are synthetic; monetary cost is unknown.
These results are not a comparison of live LLM and Jev quality.
The [historical live evidence](../../packages/engine/prototypes/jev/LIVE-RESULTS.md) remains unchanged.

### Declaration-stripping baseline exception

The approved plan's literal assertion that every `stripInternal` comparison is identical does **not** pass.
An independent checkout of pre-implementation revision `35c6f71e` produces the same rejected paths:

- Client: `lib/chart-manager/tiling.d.ts`, `lib/connection-manager/connection-manager.d.ts`, and `lib/orchestrator/request-coordinator.d.ts`.
- Engine: `lib/prompt/prompt-builder.d.ts` and `lib/prompt/request-serializer.d.ts`.
- Protocol: `lib/response.d.ts`.
- Realtime: `lib/greeting-coordinator.d.ts`.
- OpenAI realtime: `microphone-publication-gate.d.ts`.

The comparison checks whether enabling declaration stripping changes emitted types.
Existing internal declarations cause these differences.
This integration does not enable stripping, remove those declarations, or change the comparison tool.
The final comparison found no new rejected paths. The new Jev package compares identically.

## Remaining product decisions

Live provider behavior, account model availability, account pricing, and representative quality remain unverified by this implementation.
Promotion requires the separate evidence and owner decisions in the evaluation reference.
Hosted Jev remains outside this integration.

The work is recorded locally on `feat/replaceable-planners`.
No push, pull request, or merge was performed.
