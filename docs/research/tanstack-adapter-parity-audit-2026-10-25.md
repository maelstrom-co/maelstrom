# TanStack adapter parity and prompt-cache mapping

Keep the current typed-decision transports. TanStack AI 1.0.0 loses duplicate
evidence and changes score encoding. These failures block replacement even if
other rows pass. Keep Maelstrom's validation and policy unchanged.
[Transport requirements][m-contract] · [OpenAI conversion][t-evaluate]

## Evidence boundary

This reference is for maintainers evaluating an adapter bridge. Maelstrom's
baseline is `7ad0d55ef07fb75b664aa696fdc3df8afcea1a9d`. The installed TanStack
packages are 1.0.0, pinned to release commit
`5651e07e3181745984155ad88b65b86b8528844e`. All 21 inspected TanStack source files
matched that commit byte-for-byte. This comparison checks source provenance,
not runtime behavior. [Lockfile][m-lock] · [Release source][t-exports]

The [earlier alignment report][prior] supplies context. Source inspection here
independently checks the current transports, validators, public exports, and
provider mappings. Context7 supplied current TanStack, OpenAI, and Gemini docs.
The release source controls installed API claims when newer docs differ.
Provider docs cited below were retrieved on 2026-10-25 and are not versioned.

## Typed-decision parity

The public factory is `createOpenaiDecider(model, apiKey, config?)` from
`@tanstack/ai-openai`; it returns an adapter with `evaluate(options)`.
`openaiDecider` reads the environment. Neither `openaiEvaluate` nor a top-level
`evaluate()` function is exported by the inspected packages. Core exports
`decide()`, but Maelstrom excludes it: its score mapping rounds the fractional
score instead of selecting the most probable level.
[Provider exports][t-exports] · [Core exports][t-core-exports] ·
[Score mapping][t-decide]

`evaluate()` takes `model`, `state`, `questions`, a required `logger`, and optional
`abortSignal` and `modelOptions`. The OpenAI implementation ignores `modelOptions`.
It posts to `/v1/decisions` and returns `{ model, answers, usage }`, or throws.
`EvaluateError` exposes `code`, `model`, `answers`, and `usage`, without a raw body
or structured refusal IDs. A bridge must stringify non-string state and
structured choice descriptions before this call.
[Adapter contract][t-types] · [Implementation][t-evaluate] ·
[Bridge normalization rule][m-contract]

Pass means the source supplies the needed evidence or control. Fail means it
loses evidence or conflicts with the contract. Unproven means bridge composition
still needs evidence. The offline checks below confirm selected adapter behavior;
they do not implement a bridge.

| Requirement | Source status | Finding and bridge consequence |
| --- | --- | --- |
| Duplicate answer names | Fail | `Object.fromEntries` keeps the last converted answer. Maelstrom rejects a repeated name before record conversion. [Adapter][t-evaluate] · [Decoder][m-decisions] |
| Duplicate probability names | Fail | Choice and score arrays become records with `Object.fromEntries`. Duplicate keys disappear; `String()` also hides invalid key types. [Adapter][t-evaluate] · [Decoder][m-decisions] |
| Refused-question identity | Fail | The error message names only the first refusal. The structured refusal list is discarded. Missing answers cannot identify refusals safely. Usage and converted other answers survive, but malformed other answers can throw before the refusal error. [Adapter][t-evaluate] · [Required ordering][m-decisions] |
| Model echo | Pass, evidence only | Results and refusal errors retain `decision.model`; the adapter does not compare it. Preserve TypeSafe's strict echo check where required. Current Decisions decoding does not require an echo. [Adapter][t-evaluate] · [TypeSafe][m-typesafe] · [Decisions][m-decisions] |
| Score labels and descriptions | Fail | Maelstrom sends `{ label: String(index), description }`. TanStack sends `{ label: criterion }` and rebuilds the legend from response labels. No evaluate option restores separate fields. [Request encoding][m-decisions] · [Adapter][t-evaluate] |
| Invalid probabilities and answer sets | Fail | Numeric values survive conversion, but the adapter checks no ranges, sums, key sets, or most-probable choice. The fixtures confirm acceptance of invalid ranges and key sets. Keep the shared validator: finite probabilities in `[0, 1]`, sum tolerance `0.02`, exact options, score bounds, and legend. Raw checks must precede key coercion. [Validator][m-validator] · [Adapter][t-evaluate] |
| Raw reply preservation | Fail | The result and `EvaluateError` omit the original parsed reply, including decode failures. Maelstrom retains parsed replies before validation. [Result type][t-types] · [Transport][m-flow] |
| Safe HTTP errors | Fail | SDK errors expose `status`, `type`, and `code`, but their messages can contain provider body text. The adapter logs the message and rethrows. Removing headers does not remove a key echoed in a body. [SDK error][sdk-error] · [Adapter logging][t-evaluate] · [Error projection][t-error] |
| Bounded body reads | Fail | SDK parsing reads the full body with `response.text()`. There is no Maelstrom-equivalent 256 KiB success cap or 4 KiB/250 ms error-body limit. [SDK parsing][sdk-parse] · [SDK errors][sdk-client] · [Existing bounds][m-fetch] |
| Timeout and cancellation mapping | Unproven | `abortSignal` reaches the SDK; typed abort, network, and timeout errors exist. The adapter rethrows instead of returning a transport failure. A bridge must retain Maelstrom's timeout deferral and caller-abort precedence. [Adapter][t-evaluate] · [SDK errors][sdk-error] · [Call flow][m-flow] |
| Disabled SDK retries | Pass, explicit configuration only | Factory config accepts `maxRetries: 0`; the installed SDK defaults to two retries. The adapter only passes `signal` per request, so `modelOptions` cannot disable retries per call. A bridge must configure its client with zero retries. [Factory][t-evaluate] · [Client config][t-client] · [SDK defaults][sdk-client] |

Keep the existing usage checks too: input and output counts must be nonnegative
safe integers, including on refusal replies. [Decisions decoder][m-decisions]

### Required raw-response boundary

A future bridge needs the original parsed body before answer/probability arrays
become records. It must preserve all names, key types, refusal IDs, model, usage,
and partial answers, including on decode failure. It must reject unknown and
duplicate question IDs before handling a refusal. Keep the existing score wire
fields and the most-probable-level rule. Reconstructing discarded evidence from
answer gaps or exception text cannot meet this contract.
[Decoder][m-decisions] · [Validation][m-validator] · [Transport result][m-flow]

The boundary must own bounded reads, sanitized status/type/code failures,
cancellation, and retry settings before SDK parsing or adapter logging can expose
body text. A fetch wrapper could capture bounded replies, but it does not repair
score encoding or automatically establish parity. The public evaluate result
alone is insufficient. Keep all existing contract cases unchanged; an upstream
change or another raw-response boundary needs the same proof.
[Body reader][m-fetch] · [Transport suite][m-suite] · [Adapter][t-evaluate]

## Prompt-cache mapping

Prompt caches reuse provider input processing. TanStack's tool-result cache
returns previous executor results and has separate keys and authorization
requirements. `threadId` does not make a shared tool cache session-safe.
[Prompt-cache resolution][t-chat] · [Tool cache][t-tool-cache]

This mapping covers OpenAI Responses and Gemini GenerateContent text paths,
not the Decisions endpoint or Gemini's agentic-video Interactions path.
[OpenAI adapter][t-text] · [Gemini mapping][t-gemini]

| Concern | OpenAI Responses | Gemini GenerateContent |
| --- | --- | --- |
| Stable session identity | Maelstrom passes `ctx.origin.sessionId` as `threadId`. Core defaults the cache key to it. This is not an OpenAI conversation resource. [Planner][m-planner] · [Core][t-chat] | The same Maelstrom identity reaches core, but this adapter does not map `threadId` to a provider cache key. [Completion][m-completion] · [Mapping][t-gemini] |
| Common default | Omitted `promptCache` resolves to `{ retention: 'short', key: threadId }`; an empty explicit key falls back to `threadId`. [Core][t-chat] | Core resolves the same value, but the adapter ignores common `promptCache`. It creates no cache resource. [Mapping][t-gemini] |
| Default wire fields | On `api.openai.com` or a subdomain, short retention sends `prompt_cache_key`, truncated to 64 code points, and no retention field. On another host, short retention omits the key. [Mapping][t-cache] | No explicit cache field by default. Supported models may use provider implicit caching without a request option. [Mapping][t-gemini] · [Official guide][g-cache] |
| Common option values | For models before GPT-5.6, `long` sends key plus `prompt_cache_retention: '24h'`; `none` emits no cache fields and does not disable provider implicit caching. For GPT-5.6+ name matches, `long` sends key plus `prompt_cache_options: { ttl: '30m' }`; `none` sends `{ mode: 'explicit' }` without adding breakpoints. [Fields][t-cache] · [Model match][t-models] | `short`, `long`, `none`, and common key overrides have no provider mapping. Do not treat `none` as disabling Gemini implicit caching. [Mapping][t-gemini] |
| Explicit precedence | `modelOptions.prompt_cache_key` and other explicit fields override generated fields by property, without merging nested objects. A provider key override bypasses the common-key clamp. [Request spread][t-text] | `modelOptions.cachedContent: 'cachedContents/…'` passes into SDK `config`, then the wire `cachedContent` field. There is no competing common mapping. [Options][t-gemini-options] · [Request][t-gemini] · [SDK conversion][g-convert] |
| Retry and prefix stability | The session key and system prompt remain stable on planner correction. Diagnostics precede the original user prompt, so the entire request is not byte-identical. History or schema changes can also change the prefix. [Planner][m-planner] · [Correction][m-retry] · [Call][m-call] | The same correction behavior applies. Gemini joins system prompts into `systemInstruction` and maps history to `contents`. Reuse depends on common content, not the local thread ID. [Mapping][t-gemini] · [Guide][g-cache] |
| Cache-read response field | Provider `usage.input_tokens_details.cached_tokens` becomes `promptTokensDetails.cachedTokens` only when positive. Missing and explicit zero both disappear. Positive cache writes use `cache_write_tokens`. [Normalizer][t-openai-usage] | Provider `usageMetadata.cachedContentTokenCount` becomes `promptTokensDetails.cachedTokens` only when positive. Missing and explicit zero both disappear. [Normalizer][t-gemini-usage] · [SDK type][g-types] |

### Provider configuration limits

OpenAI documents implicit caching by default on supported models. GPT-5.6+ uses
`prompt_cache_options.mode` (`implicit` by default) and `ttl` (`30m` by default;
current docs also describe `12h`). Earlier models use `prompt_cache_retention`:
where both values are supported, organizations without Zero Data Retention
default to `24h`; those with it default to `in_memory`. A missing retention field
does not prove short provider retention.
The installed common mapping's `long` value therefore does not mean the same
lifetime across model families. [Official guide][o-cache] · [Release mapping][t-cache]

Core resolves common cache settings once per invocation and reuses them for model
calls and structured finalization. A stable key does not prove a stable full
prefix or a cache hit. Verify serialized bodies separately for retries and
finalization. [Call options][t-call-options] · [Finalization][t-finalization]

The release's public OpenAI option type spells retention `'in-memory'`; the
official wire spelling is `'in_memory'`. It also lacks an explicit
`prompt_cache_options` field. Do not publish the mismatched spelling as valid
provider configuration or infer support for newer options from current docs.
[Installed option type][t-options] · [Official guide][o-cache]

Gemini documents implicit caching by default for Gemini 2.5 and newer models.
Explicit GenerateContent caches require separate resource creation; the default
TTL is one hour. Requests then reference the resource through `cachedContent`.
Current docs limit explicit caching to supported Gemini 2.5/3 models and exclude
Gemini 4 and Interactions. This audit creates no resources and makes no hit-rate,
latency, or savings claim. [GenerateContent guide][g-cache] · [Current overview][g-overview]

Maelstrom preserves explicit zero if it receives one and never adds cache counters
to input totals. It cannot recover counters already omitted by an adapter. Keep
unknown distinct from a measured zero; raw provider fixtures must test both.
[Telemetry normalizer][m-usage]

## Offline verification

Use public factories with dummy keys and mocked fetch only:

- OpenAI: `createOpenaiDecider` and `createOpenaiChat` accept
  `{ fetch, maxRetries: 0 }`. The provider package resolves `openai@7.43.0`,
  not the separate 6.x SDK also present in the workspace. The fixtures call public
  `decide()` with `debug: false`; they import no private SDK helpers.
  [Factories][t-exports] · [Client options][t-client] · [Lockfile][m-lock]
- Gemini: `createGeminiChat` is public. Its config extends `GoogleGenAIOptions`
  from installed `@google/genai@2.21.0`, which has no constructor `fetch` option.
  GenerateContent calls global `fetch`. Mock and restore that global in an
  isolated test process; do not substitute the unrelated Interactions HTTP client.
  `httpOptions.retryOptions.attempts: 1` limits that path to one attempt.
  [Factory][t-gemini] · [Config][t-gemini-client] · [SDK options][g-client] ·
  [Fetch dispatch][g-fetch]

The [Decision probes][decision-probes] and [cache probes][cache-probes] pass
13 cases in isolated child processes. They inspect outgoing HTTP bodies, returned
answers and errors, streamed byte counts, provider attempts, and usage fields.
Fetch replacements never call the network and reject unexpected destinations.
Dummy keys are literals. Gemini resolves its public package from the demo
workspace, which already declares it; no dependency or demo file changed.

Nine Decision cases confirm duplicate collapse, unchecked probabilities, score
encoding and rounding, refusal metadata, missing model echoes, lost raw replies,
provider text in HTTP errors, full consumption of a 300 KiB success body, retry
control, and distinct timeout/cancellation exceptions. The four cache cases
confirm OpenAI key/default/override mappings, identical SDK retry bodies,
Gemini's unmapped common hints and explicit cache reference, and both adapters'
loss of zero cache-read counts. These observations do not prove cache hits or
application error mapping. The 4 KiB/250 ms error-body limit remains source-only.

The original duplicate-rejection assertion failed because `decide()` accepted
the duplicate reply. The final characterization records that gap. Inverting the
retry-control condition also failed on the observed HTTP outcome; restoring it
passed. Existing Decisions and transport-contract suites passed all 105 tests.

From the workspace root, with Bun 1.4.3:

```sh
bun install --frozen-lockfile
bun test --conditions=@maelstrom-co/source \
  packages/evals/src/eval/tanstack-decisions-parity.test.ts \
  packages/evals/src/eval/tanstack-prompt-cache-mapping.test.ts
bun test --conditions=@maelstrom-co/source \
  packages/planner-jev/src/lib/openai-decisions-client.test.ts \
  packages/planner-jev/src/lib/provider-transport-contract.test.ts
```

Configured final gates use:

```sh
NX_NO_CLOUD=true NX_DAEMON=false bunx nx run-many \
  -t typecheck,test,check -p @maelstrom-co/evals @maelstrom-co/source \
  --skip-nx-cache --output-style=static --parallel=1
```

Uncached typecheck, tests, and Biome passed for evals, root, and 22 prerequisite
tasks: 363 eval tests, 513 script tests, and 225 Actions tests, with zero failures.
Nx retained flaky-task warnings for the protocol and LiveKit-agent builds; both
passed. Typecheck covers the runners and typed Decisions fixture; embedded cache
probes are runtime-checked.

An intervening root-suite run failed with `ENOSPC` in an existing archive test.
Removing the integrated research clone freed space; the focused archive suite
then passed without source changes. Final verification runs tasks sequentially
to reduce temporary disk use.

No transport, policy, telemetry, dependency, Engine, demo, or pet-shop
implementation changed. The streaming work in PR #346 remains unchanged.
No live provider call, cache-resource creation, or paid evaluation ran.

## Documentation verification

Passed: configured `bun scripts/lint-docs.ts` with Vale 3.18.0, including style
sync and all 78 authored files. It reported zero errors and one existing warning
at `packages/protocol/README.md:281`; this report had no warnings. Markdownlint
passed with MD013 disabled for tables. `glow -s notty -w 180` rendered the text,
tables, and links for terminal inspection. This standalone note needs no
docs-site sidebar entry or site build. Browser CSS remains untested.
The external source targets returned HTTP 200 through raw-source or official-doc
endpoints. Baseline source links matched local files; reference IDs, line ranges,
the architecture anchor, and whitespace checks passed. Local probe links resolve
within this evidence branch.

[prior]: https://github.com/maelstrom-co/maelstrom/blob/f3829d4f75ce8cb1cc37cfa3e2f6b6937bd6f604/docs/research/tanstack-ai-alignment-2026-10-25.md
[m-lock]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/bun.lock
[m-contract]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/docs/architecture.md#planner-provider-call-flow
[m-decisions]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-jev/src/lib/openai-decisions-client.ts#L178-L318
[m-typesafe]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-jev/src/lib/typesafe-client.ts#L125-L161
[m-validator]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-jev/src/lib/reply-validation.ts
[m-flow]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-jev/src/lib/provider-call.ts
[m-fetch]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-jev/src/lib/provider-fetch.ts
[m-suite]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-jev/src/lib/provider-transport-contract.test.ts
[m-planner]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-llm/src/lib/llm-planner.ts#L139-L213
[m-completion]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-jev/src/lib/llm-call.ts#L40-L113
[m-call]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-llm/src/lib/call-llm.ts#L18-L56
[m-retry]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-llm/src/lib/retry-prompt.ts
[m-usage]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/telemetry/src/usage.ts
[t-exports]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-openai/src/index.ts
[t-core-exports]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/index.ts#L122-L161
[t-evaluate]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-openai/src/adapters/evaluate.ts
[t-types]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/evaluate/adapter.ts#L105-L192
[t-decide]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/evaluate/index.ts#L233-L268
[t-error]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/error-payload.ts#L76-L103
[t-client]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-openai/src/utils/client.ts#L1-L11
[t-chat]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/index.ts#L6234-L6252
[t-call-options]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/index.ts#L2059-L2085
[t-finalization]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/index.ts#L4745-L4767
[t-cache]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-openai/src/prompt-cache.ts#L1-L52
[t-text]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-openai/src/adapters/text.ts#L174-L215
[t-models]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-openai/src/model-meta.ts#L2715-L2728
[t-options]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-openai/src/text/text-provider-options.ts#L89-L99
[t-gemini]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-gemini/src/adapters/text.ts#L1515-L1664
[t-gemini-options]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-gemini/src/text/text-provider-options.ts#L173-L176
[t-gemini-client]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-gemini/src/utils/client.ts#L1-L44
[t-openai-usage]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/openai-base/src/usage.ts#L88-L138
[t-gemini-usage]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-gemini/src/usage.ts#L112-L196
[t-tool-cache]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/middleware/tool-cache-middleware.ts
[sdk-client]: https://github.com/openai/openai-node/blob/d02d4de77ea7a6f82325c02e6f44deb34ee3992c/src/client.ts
[sdk-error]: https://github.com/openai/openai-node/blob/d02d4de77ea7a6f82325c02e6f44deb34ee3992c/src/core/error.ts#L6-L125
[sdk-parse]: https://github.com/openai/openai-node/blob/d02d4de77ea7a6f82325c02e6f44deb34ee3992c/src/internal/parse.ts#L18-L85
[g-client]: https://github.com/googleapis/js-genai/blob/27af8977598edb68ffccadcd34fae967205a8740/src/client.ts#L50-L124
[g-fetch]: https://github.com/googleapis/js-genai/blob/27af8977598edb68ffccadcd34fae967205a8740/src/_api_client.ts#L787-L858
[g-types]: https://github.com/googleapis/js-genai/blob/27af8977598edb68ffccadcd34fae967205a8740/src/types.ts#L3700-L3720
[g-convert]: https://github.com/googleapis/js-genai/blob/27af8977598edb68ffccadcd34fae967205a8740/src/converters/_models_converters.ts#L1677-L1687
[o-cache]: https://developers.openai.com/api/docs/guides/prompt-caching
[g-cache]: https://ai.google.dev/gemini-api/docs/generate-content/caching
[g-overview]: https://ai.google.dev/gemini-api/docs/caching
[decision-probes]: ../../packages/evals/src/eval/tanstack-decisions-parity.test.ts
[cache-probes]: ../../packages/evals/src/eval/tanstack-prompt-cache-mapping.test.ts
