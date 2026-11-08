# Jev replacement candidates for the light tier and router

Ticket: ClickUp MAE-958 "Jev replacement candidates for the light tier and router".
Research date: 2026-11-08. Builds on `docs/research/loop-model-candidates.md` (branch
`research/loop-model-candidates`, MAE-822). Related: MAE-849 (Clef-flash against Jev, deep
benchmark design lives there, not here).

Model lineups change weekly. Every fact below carries a source, read on 2026-11-08 unless
marked otherwise. No candidate was called in this session. Only the Jev figures are measured
(in our prototype). Every other latency or accuracy figure is either a vendor claim with a
source, or marked "unmeasured".

## Summary

- A new class of drop-in replacements now exists: hosted decision APIs that take the same
  `state` plus typed `questions` request as Jev and return a choice with per-option
  probabilities. The credible hosted ones are Cloudflare **Clef-flash**, **Clef** and
  **Clef-omni** on Workers AI, and the **OpenAI Decisions API** (`gpt-6-luna`, GA since
  2026-10-22). Our decider would need only a new transport, not a new prompt shape.
- Open-weight decision models with the same request shape (Kev, PostHog Jeeves, Laya through
  Ollaya, Fastino GLiNER2.5-Decide) are credible for the local server, but none runs inside a
  Worker and none is hosted by a provider we use.
- Chat LLMs with JSON schema or enum output (Workers AI, Groq, Cerebras, Haiku 5.5, Gemini
  Flash-Lite, Luna through chat) can do the job too, but they give no calibrated confidence,
  need the multi-question request translated into one schema, and pay for output tokens.
  The router already has a Luna structured-output path in `agent-session.ts` (`#route`).
- Embeddings and rerankers fit the two-way router well, but not the light tier, which has to
  resolve facts ("my usual food" to a SKU) across about ten questions at once.
- Fine-tuning paths are thin right now: OpenAI's fine-tuning platform is winding down and
  `gpt-4.1-nano` shut down on 2026-10-23, Workers AI LoRA is open beta with most LoRA bases
  retiring on 2026-11-20, and Cloudflare's Clef RL fine-tuning is design-partner only.

- We already benchmarked the OpenAI Decisions API in MAE-832 (planner-jev Decisions client on
  main, run 2026-10-08, 155 scenarios times 3 repeats). It was faster (provider call p50 193
  against 281 ms) but much less accurate (selection 52.3% against 86.5% for Jev 1.13.0, overall
  pass 44.9% against 75.2%) and refused some calls. It drops off the shortlist. It stays on a
  periodic re-bench, since the model may improve.
- Jev itself has a newer model, `jev-1.14.0` (released mid October 2026, same listed price, image
  input, a new `box` question type, opt-in long context). We pin `jev-1.13.0`. Benchmarking
  1.14.0 against 1.13.0 comes before any switch to another provider.

**Shortlist:** Clef-flash, Clef (27B), and an embedding router for route choice only. See
[Shortlist](#shortlist-top-3).

## The bar: what Jev does today

Both call sites POST to `https://api.typesafe.ai/v1/systemone` with `model` (`JEV_MODEL`, for
example `jev-1.13.0`) and bearer `TYPESAFE_API_KEY`, using plain `fetch`. The same code runs in
the Cloudflare Worker / Durable Object and in the local Node/Bun server. Source:
`apps/demo/src/server/keep-layout-action-planner.ts` and `apps/demo/src/server/agent-session.ts`
on `ktrz/composed-planner-prototype`.

### Light tier (one call per Planner request)

- Request: `state` is an object with `latestRequest` (the intent text), optional `facts`
  (metadata such as the usual SKU), and `screen` (one entry per Vessel instance: vessel, view,
  onScreen). `questions` is a map of `choice` questions, each with `instructions` and
  `criteria` (option key to description).
- Questions per call, on the pet shop: `scope` (3 options: one_action, several_actions,
  screen_change), `action` (one option per non-side-effect action across the four Vessels, plus
  `needs_screen_change`, about ten options), and one `param_<name>` question per action
  parameter name (orderId, sku, species, foodType, maxFatPercent, lowerFatOnly, query,
  quantity). Enumerated parameters list every allowed value (about 15 SKUs, 4 orders) plus
  `stated_other` and `not_stated`. Up to 250 options per question are allowed (`MAX_OPTIONS`).
  So roughly ten questions per call, the largest with about 17 options.
- Prompt size: not logged for the light tier. Estimated low thousands of tokens (unmeasured).
- Output used: per question, `choice` and `confidence`. The planner validates the pick, binds
  parameters, and hands off to the LLM Planner on low confidence, a missing value, a side
  effect, or a screen change. Timeout 800 ms (`DECISION_TIMEOUT_MS`).
- Measured (Jev `jev-1.13.0`): eval of 30 intents gave 13/13 light answers correct, 0 wrong,
  1 missed light (13/14 recall), 17/30 hand-offs (16 expected). Light tier p50 248 ms, max
  318 ms. Decision call p50 252 ms, max 319 ms across 26 calls
  (`apps/demo/prototype-mae826/results/light-tier-eval.txt`). Journey runs: 12/12 picks
  correct, 233 to 308 ms per pick (`results/journey-results.md`).

### Router (one call per user utterance)

- Request: `state` has `recentConversation` (role-prefixed lines) and `latestRequest`. One
  `choice` question `route` with two options, `ui_only` and `needs_tools`.
- Measured: about 440 input tokens and 34 output tokens per call (Jev usage in the journey
  logs, `results/raw/*.server.log`). Router p50 267 to 277 ms in the journey, 0.24 to 0.47 s
  range.

### What a replacement must give

1. A pick per question from a closed option set, in one call, for about ten questions.
2. A confidence per pick (the light tier and router log it, and `minConfidence` gates on it).
3. Median well under the 800 ms timeout, ideally under Jev's 250 ms.
4. Callable from both the Worker and a local Node/Bun server.
5. Accuracy at least 13/13 on the fixed eval with no wrong light answers.

## Candidate table

Column notes. "Worker" and "Local" say how the call would be made. "Latency" is the vendor's
published figure with its source, or "unmeasured". "Struct" is structured output support.
"Ctx" is the context window. Prices are USD per 1M tokens, input / output.

### A. Hosted decision APIs (same request shape as Jev)

| # | Candidate | Provider | Worker / Local | Latency | Cost | Struct | Ctx | License, availability | Fit against Jev's job |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Clef-flash `@cf/cloudflare/clef-flash` (9B, Qwen3.5-9B backbone) | Cloudflare Workers AI | `env.AI.run` binding / Workers AI REST. TanStack `@tanstack/ai-cloudflare` documents only `typesafe/jev` as decider ID, so a thin custom decider is likely | Vendor: median 38.8 ms, p95 122.4 ms (launch post, method not described). Ours: unmeasured | $0.038 input, output free (cut from $0.090 on 2026-10-09) | `choice`, `score`, `noul` questions, 1 to 64 per request, per-option probabilities | 24,576 hosted (cut from 64K with the price drop) | Weights Apache 2.0. Hosted, no beta label on model page | Drop-in shape. Our ten-question request fits the 64-question and 24K limits. Vendor table shows a weak CLINC150+OOS score (66.77 against Jev 89.27), which matters for hand-off detection. Covered in depth by MAE-849 |
| 2 | Clef `@cf/cloudflare/clef` (27B, Qwen3.8-27B backbone) | Cloudflare Workers AI | Same as Clef-flash | Vendor: launch median 209.3 ms, p95 238.6 ms. After 2026-10-09 speedup: about 152 ms median at about 800 tokens, 305 ms at about 3,400 tokens. Ours: unmeasured | $0.24 input, output free | Same as Clef-flash | 65,536 | Weights Apache 2.0. Hosted | Drop-in shape. Vendor accuracy at or above Jev on most listed suites, CLINC150+OOS 97.43. Likely near Jev latency for our prompt size, so the win is accuracy and cost, not speed |
| 3 | Clef-omni `@cf/cloudflare/clef-omni` (30B MoE, 3B active) | Cloudflare Workers AI | Same as Clef-flash | Vendor: about 20 ms for text requests (changelog 2026-10-09). Ours: unmeasured | $0.15 input, output free | Same question types, plus audio and video input | 64,000 | Model page links an HF license, terms not stated on page | Drop-in shape. Fastest claimed, but no published accuracy table. Worth a run next to Clef-flash |
| 4 | OpenAI Decisions API, `gpt-6-luna` | OpenAI | `fetch` or `openai` JS SDK over HTTPS from both. TanStack `openaiDecider('gpt-6-luna')` in `@tanstack/ai-openai` | Vendor: "about 10x faster than the Responses API", no absolute figure. Ours (MAE-832, 2026-10-08): provider call p50 193 ms against Jev 1.13.0's 281 ms, but selection accuracy 52.3% against 86.5% | $0.10 input ($0.01 cached), output free | `predicate`, `choice`, `score`. Choice returns `choice`, `probabilities`, `confidence`. Up to 400 questions | Not stated on the guide page (Luna chat is 1.05M) | GA 2026-10-22. US and EU regional processing, ZDR for eligible customers | Near drop-in: request field is `input` not `state`, and `predicate` replaces `noul`. Demo already holds an OpenAI key and adapter. Can refuse a question (billed). Ruled out for now by the MAE-832 accuracy gap, re-bench periodically |
| 5 | Jev through a gateway (Cloudflare AI Gateway `typesafe/jev`, OpenRouter `~typesafe/jev-latest`, Vercel `typesafe-ai/jev`) | TypeSafe via gateway | Cloudflare: `env.AI` binding with gateway / REST. Others: HTTPS | Jev's own: our 233 to 319 ms. Gateway overhead unmeasured | Jev $42 per billion input tokens (typesafe.ai) plus any gateway fee | Same as Jev | Jev 32K (Clef launch post) | Jev in early access | Not a replacement model. Listed because it could remove the separate TypeSafe key and put Jev behind the same binding as Clef for A/B tests |
| 6 | Clairic `@cf/cloudflare/clairic` | Cloudflare Workers AI | Binding / REST | No claim | $0.10 input, output free | Typed `fields` (text, date, number, list, estimate), not choices | 65,536 | Preview | Not a fit for picks. Could extract a free number (maxFatPercent) or text span (query) that the light tier now hands off, as a second call |
| 7 | GLiNER2.5-Decide hosted API (agent.fastino.ai) | Fastino | HTTPS from both | Vendor (self-hosted bench): p50 38.3 ms on V100, 167.3 ms on CPU, short docs | Hosted price not published | Label sets at call time, typed decisions. Jev request shape not confirmed | Not stated (tested to 1,024 tokens) | Weights Apache 2.0. Hosted API exists, terms not found | Encoder classifier (340M). Fast, but vendor bench does not compare against hosted Jev and fact resolution across ten questions is unproven |

### B. Open-weight decision models (self-hosted, Jev request shape)

| # | Candidate | Provider | Worker / Local | Latency | Cost | Struct | Ctx | License, availability | Fit |
|---|---|---|---|---|---|---|---|---|---|
| 8 | Kev-4B (also 0.8B, 9B, 27B) | Jared Palmer, open source | Worker: no (needs a GPU host, e.g. own Modal endpoint, cold start about 35 s). Local: `python -m kev.serve`, MLX on Apple Silicon, `/v1/systemone` compatible | Vendor: Kev-4B 18.1 ms on H100 (6 questions, short text), 721 ms on Apple M5 (136 ms cached). Ours: unmeasured | Own hardware | `choice` (1 to 255 options), `score`, `noul` | Validated 8,192 (27B: 65,536) | Apache 2.0, released 2026-09 | Same API as Jev, so zero code change locally. README index: Kev-27B 52.3 against Jev 54.0, smaller sizes lower. Option order can change answers. Local dev or offline eval only |
| 9 | PostHog Jeeves-9B (no-think mode) | PostHog, open source | Worker: no. Local: Jeeves server on CUDA or a 48 GB Apple Silicon Mac, `/v1/systemone` compatible | Vendor (H100 FP8): no thinking 22 ms median, 46 ms p90. With thinking 1.2 to 1.9 s median | Own hardware | Jev question types | Not stated on card | Weights Apache 2.0, code MIT | Vendor test 0.905 against Jev 0.857 (thinking on), no-think 0.806. Heavy hardware for a laptop. Offline benchmark reference only |
| 10 | Laya via Ollaya (`laya:en`, ModernBERT-large, 322M/421M) | Convai Innovations, Ollaya runtime | Worker: no. Local: `ollaya serve`, `@tanstack/ai-ollaya` `ollayaDecider` | Vendor: 18 to 21 ms (RTX 5090). Clef launch table: median 5.8 ms, p95 222.5 ms | Free, local | `choice`, `score`, `boolean` | Not stated | Ollaya Apache 2.0, model license not stated | Clef's table puts Laya far below Jev on accuracy (BFCL 38.13 against 95.75). Not a credible replacement, useful only as a no-key local stub |
| 11 | GLiNER2.5-Decide self-hosted (340M) | Fastino | Worker: no (Python, `gliner2`). Local: Python sidecar, runs on CPU | Vendor: 167.3 ms CPU, 38 to 47 ms GPU | Free, local | Label sets | Not stated | Apache 2.0 | As row 7. Cheapest CPU option, unproven on our multi-question shape |
| 12 | Clef-flash or Clef weights self-hosted | Cloudflare, Hugging Face | Worker: use the hosted binding instead. Local: own GPU serving | Unmeasured | Own hardware | Same as hosted | Not stated | Apache 2.0 | Lets the local server run the same model as the Worker without a Cloudflare token. Serving stack not documented on the pages read |

### C. Hosted chat LLMs with structured output

How these would be used: translate the questions map into one JSON schema with one `enum`
property per question, send state plus question text as the prompt, read the picks. No
calibrated confidence comes back. Output is about ten short fields, so output price and
tokens per second matter less than time to first token and network.

| # | Candidate | Provider | Worker / Local | Latency | Cost | Struct | Ctx | License, availability | Fit |
|---|---|---|---|---|---|---|---|---|---|
| 13 | `@cf/google/gemma-4-26b-a4b-it` | Workers AI | Binding / REST or OpenAI-compatible endpoint. `@tanstack/ai-cloudflare` | Unmeasured | $0.10 / $0.30 | Function calling yes, `response_format` listed, `json_schema` not confirmed | 256,000 | Hosted, Cloudflare's suggested small replacement | Cheapest capable Workers AI chat model. Reasoning on, no documented off switch |
| 14 | `@cf/qwen/qwen3.8-27b` | Workers AI | As above | Unmeasured | $0.45 / $3.20 | Function calling yes, `json_schema` not confirmed | 262,144 | Hosted | `reasoning_effort` lowest is `low` (default `xhigh`), so latency risk |
| 15 | `@cf/zai-org/glm-4.7-flash` | Workers AI | As above, OpenAI-compatible `/v1/chat/completions` | Unmeasured | $0.06 / $0.40 | Function calling yes, `json_schema` not confirmed | 131,072 | Hosted | Cheap, reasoning model, toggle undocumented |
| 16 | `@cf/openai/gpt-oss-20b` | Workers AI | As above | Unmeasured | $0.20 / $0.30 | Not confirmed on model list | Not stated | Hosted, Apache 2.0 weights | Plausible. Faster hosts exist (rows 22, 27) |
| 17 | `@cf/openai/gpt-oss-120b` | Workers AI | As above | Unmeasured | $0.35 / $0.75 | Not confirmed | Not stated | Hosted | Quality reference inside the binding |
| 18 | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Workers AI | As above | Unmeasured | $0.293 / $2.253 | JSON Mode documented (best effort, can fail with "JSON Mode couldn't be met", no streaming) | Not stated | Hosted | One of the few with documented JSON Mode. No reasoning delay |
| 19 | `@cf/meta/llama-3.1-8b-instruct` (and `-fp8-fast` on the price list) | Workers AI | As above | Unmeasured | $0.282 / $0.827 (fp8-fast $0.045 / $0.384) | JSON Mode documented for the base ID | Not stated | Hosted. `-fp8` variant retires 2026-11-20. No model page found for `-fp8-fast` | Small and fast. Accuracy on fact resolution doubtful |
| 20 | `@cf/ibm-granite/granite-4.0-h-micro` | Workers AI | As above | Unmeasured | $0.017 / $0.112 | Function calling mentioned | Not stated | Hosted | Cheapest. Unknown quality |
| 21 | `@cf/mistralai/mistral-small-3.1-24b-instruct` | Workers AI | As above | Unmeasured | $0.351 / $0.555 | Not confirmed | 128K | Hosted | No reasoning delay. Unknown structured output |
| 22 | `openai/gpt-oss-20b` | Groq | HTTPS from both. `@tanstack/ai-groq` | Vendor: 1,000 tokens/s. TTFT not published | $0.075 / $0.30 | Strict `json_schema` (constrained decoding). No streaming or tools with it | 131,072 | Production | Strong price and speed. Reasoning model, set effort low |
| 23 | `openai/gpt-oss-120b` | Groq | As above | Vendor: 500 tokens/s | $0.15 / $0.60 | Strict `json_schema` | 131,072 | Production | Higher quality than row 22 at half the speed |
| 24 | `qwen/qwen3.8-27b` | Groq | As above | Vendor: 450 tokens/s | $0.80 / $4.00 | Strict `json_schema` | 131,072 | Preview, "not for production" | Preview status rules it out for the hosted demo |
| 25 | `llama-3.1-8b-instant` | Groq | As above | Vendor: 560 tokens/s | Contact sales | JSON object mode only (no schema guarantee) | 131,072 | Production | Fast, no reasoning. No schema guarantee, pricing opaque |
| 26 | `qwen-3.8-27b` | Cerebras | HTTPS (OpenAI-compatible). No TanStack Cerebras adapter listed | Vendor: about 1,850 tokens/s (models page). TTFT not published | $0.99 / $1.49 | Strict `json_schema`, 500 enum values max | 128K paid (64K free) | Shared Inference. Developer tier "not for production" | `reasoning_effort: none` is documented, which removes thinking delay. Best chat-LLM speed candidate |
| 27 | `gpt-oss-120b` | Cerebras | As above | Vendor: about 3,000 tokens/s | $0.35 / $0.75 | Strict `json_schema` | 131K paid | Shared Inference | Fastest published throughput. Reasoning effort default medium, other levels not listed on page |
| 28 | `gpt-oss-120b`, `Meta-Llama-3.3-70B-Instruct` | SambaNova Cloud | HTTPS (OpenAI-compatible) | Unmeasured | Not listed on models page | Not listed on models page | 128K | Production | Credible host, nothing it offers that rows 23 and 27 lack |
| 29 | Nemotron 3.5 Lightning 30B A3B | Fireworks | HTTPS (OpenAI-compatible) | Unmeasured | $0.05 / $0.20 | `json_schema` enforced during generation, plus BNF grammar mode | Not read | Serverless | Grammar mode suits label outputs. Unknown quality on our task |
| 30 | Qwen3.5 9B | Together | HTTPS (OpenAI-compatible) | Unmeasured | $0.17 / $0.25 | `json_schema` and regex mode | Not read | Serverless | Same backbone as Clef-flash without the decision head. Useful as a control, not as a pick |
| 31 | `gpt-6-luna` via Responses / Chat Completions | OpenAI | `@tanstack/ai-openai` (already wired) | Unmeasured | $0.10 / $0.50 | Structured Outputs on GPT-6 family (Luna not named on the guide page) | 1.05M | GA | Already the router's non-Jev path (`#route`, effort from `ROUTER_REASONING_EFFORT`). The Decisions API (row 4) is the faster use of the same model |
| 32 | `claude-haiku-5-5` | Anthropic | HTTPS, `@anthropic-ai/sdk` or `@tanstack/ai-anthropic` (not installed) | Docs: "Fastest" in lineup, no TTFT published. Ours: unmeasured | $0.10 / $0.50 (prompts up to 100K) | Structured outputs stable, `output_config.format` with enum. First use of a schema adds grammar compile latency, cached 24 h | 1M | Released 2026-10-07, GA | Built for "classification, extraction, and routing". Adaptive thinking on by default, steer with effort. Enum casing not guaranteed. Tokenizer counts about 30% more tokens |
| 33 | `gemini-3.5-flash-lite` | Google | HTTPS, `@tanstack/ai-gemini` (installed) | Unmeasured. Prior research saw about 6 s TTFT on a 10K workload (Artificial Analysis, third party) | $0.30 / $2.50 | `response_json_schema` | 1,048,576 | Stable. Default thinking `minimal`, cannot be turned off | Thinking floor makes sub-300 ms unlikely. Unmeasured |
| 34 | `gemini-3.1-flash-lite` | Google | As above | Unmeasured | $0.25 / $1.50 | `response_json_schema` | 1,048,576 | Stable | Same thinking floor concern |
| 35 | `gemini-2.5-flash-lite` | Google | As above | Unmeasured | $0.10 / $0.40 | Structured output | Not read | Limited to past users. Only Gemini listed with thinking "Off" | Would be the best Gemini fit, but not available to new users |
| 36 | Ministral 3 3B / 8B | Mistral | HTTPS | Unmeasured | Not on models page | Not on models page | Not read | Apache 2.0 | Small, no reasoning delay. Too little verified to rank |

Excluded from row C: Workers AI models retiring on 2026-11-20 (`llama-3.2-1b-instruct`,
`llama-3.2-3b-instruct`, `qwen3-30b-a3b-fp8`, `llama-3.1-8b-instruct-fp8` and others), and large
models (Kimi, DeepSeek V4, GLM-5.3) that are slower and dearer than the job needs.

### D. Embedding, reranker and classifier approaches

| # | Candidate | Provider | Worker / Local | Latency | Cost | Struct | Ctx | License, availability | Fit |
|---|---|---|---|---|---|---|---|---|---|
| 37 | Nearest-label embeddings: `@cf/baai/bge-m3`, `@cf/qwen/qwen3-embedding-0.6b`, `@cf/baai/bge-small-en-v1.5` | Workers AI | Binding / REST. Labels embedded once, cosine in code | Unmeasured | $0.012 (bge-m3, qwen3-embedding), $0.020 (bge-small) input | Vectors, not picks. Threshold gives a rough confidence | Not stated | Hosted. `embeddinggemma-300m` is beta and retires 2026-11-20 | Good for the router (two routes, many example utterances). Poor for the light tier: cannot bind "my usual food" to a SKU from facts, or count actions |
| 38 | semantic-router style example router | Aurelio Labs (MIT, Python) | Worker: port the idea to TS (no TS port found). Local: Python or TS port | Unmeasured | Embedding cost only | Route name or `None` below a fitted threshold | n/a | MIT | Same as row 37 with a calibration step. Its `DecisionRouter` can also call Jev or Laya |
| 39 | Cross-encoder reranker `@cf/baai/bge-reranker-base` | Workers AI | Binding / REST. Query = request, contexts = option descriptions | Unmeasured | $0.003 input | Relevance score per option | Not stated | Hosted | Scores options for one question per call, so ten calls for the light tier. Plausible for the action pick alone. No fact resolution |
| 40 | Hosted embeddings from OpenAI or Google (`gemini-embedding-2`) | OpenAI, Google | HTTPS | Unmeasured | Not verified this run | Vectors | Not read | GA | Same fit as row 37, with an extra network hop from the Worker |
| 41 | Single-token or logprob classification on a chat LLM | Any chat host exposing logprobs | HTTPS | Unmeasured | Input-dominated | Probability per label token | Model dependent | Logprob support on GPT-6 or Haiku 5.5 not verified this run | Gives the confidence that rows 13 to 36 lack, one question per call unless options are coded cleverly. Decision APIs already do this natively |

### E. Fine-tuned small models

| # | Candidate | Provider | Worker / Local | Latency | Cost | Struct | Ctx | License, availability | Fit |
|---|---|---|---|---|---|---|---|---|---|
| 42 | LoRA on Workers AI (`@cf/mistral/mistral-7b-instruct-v0.2-lora`) | Workers AI | Binding with `lora` parameter / REST | Unmeasured | Free during open beta | Whatever the adapter learns. No documented JSON Mode on LoRA bases | Not stated | Open beta. Rank 8 preferred, up to 32. The Gemma and Llama-2 LoRA bases retire 2026-11-20 | Only one surviving LoRA base, old (Mistral 7B v0.2). Weak option |
| 43 | Fine-tuned Qwen3.5 9B or Llama 3.1 8B on Together | Together | HTTPS | Unmeasured | SFT $0.34 per 1M training tokens, $4 minimum. Serverless LoRA inference price not listed | `json_schema` on serving models | Not read | Available | Plausible path to a task-specific picker. Needs a labelled set larger than our 30 intents |
| 44 | LoRA SFT on Fireworks | Fireworks | HTTPS | Unmeasured | $0.50 per 1M training tokens up to 16B | Grammar and `json_schema` | Not read | Available | As row 43 |
| 45 | OpenAI fine-tuned nano | OpenAI | n/a | n/a | n/a | n/a | n/a | `gpt-4.1-nano` and its fine-tunes shut down 2026-10-23. Fine-tuning platform closed to new users, jobs end 2027-01-06 | Not viable |
| 46 | Clef RL fine-tuning, or fine-tuning Kev ourselves | Cloudflare (design partners), Kev repo | Clef: hosted binding after tuning. Kev: own GPU | Unmeasured | Not published | Jev question types | As base | Clef service: sign-up only. Kev: training code Apache 2.0 | The one fine-tune route that keeps the decision API shape. Premature until a base model clears the eval |

### F. Other approaches

| # | Candidate | Provider | Worker / Local | Latency | Cost | Struct | Ctx | License, availability | Fit |
|---|---|---|---|---|---|---|---|---|---|
| 47 | Rules plus required actions plus fallback | In repo | Same code both places | Measured 0 to 3 ms for required actions (journey results) | Free | Exact | n/a | Exists | Already ships `addToCart` and `placeOrder` with no model call. Extending rules for back navigation and plain "show my last order" would cut calls, not replace the model |
| 48 | Decision cache keyed on normalised request plus screen state | In repo (to build) | Durable Object storage or memory / process memory | Near zero on hit (unmeasured) | Free | Exact replay | n/a | n/a | Cuts repeat calls in voice sessions. Needs care: facts and screen change the right answer |
| 49 | Grammar-constrained decoding on a self-hosted small model (llama.cpp GBNF or JSON schema) | Self-hosted | Worker: no. Local: `llama-server` with `grammar` or `json_schema` | Unmeasured | Own hardware | Exact via grammar | Model dependent | llama.cpp MIT | Gives exact label outputs locally without a decision head. No confidence unless logprobs are read |

**Count: 49 candidates** (7 hosted decision APIs, 5 self-hosted decision models, 24 hosted
chat LLMs, 5 embedding or classifier approaches, 5 fine-tuning paths, 3 other approaches).

## Shortlist (top 3)

1. **Clef-flash (Workers AI).** Same request and response shape as Jev, called through the
   `env.AI` binding the hosted demo already has, input price $0.038 (Jev lists $0.042, that
   is $42 per billion), output free, Apache 2.0 weights. Vendor median 38.8 ms against Jev's 524 ms in the
   same table. Risk: weak out-of-scope intent score in Cloudflare's own table, and the hosted
   context dropped to 24K. MAE-849 owns its benchmark.
2. **Clef (27B, Workers AI).** The accuracy hedge for Clef-flash: same binding and shape,
   vendor scores at or above Jev on most suites (CLINC150+OOS 97.43), about 152 ms median at
   about 800 tokens after the 2026-10-09 speedup, $0.24 input. If Clef-flash misses hand-offs,
   this is the next step without changing code.
3. **Embedding router (Workers AI `bge-m3` or `qwen3-embedding-0.6b`), route choice only.**
   Nearest-example matching for the two-way `ui_only` against `needs_tools` route. Cheap and
   fast through the existing binding, but it cannot do the light tier's multi-question pick.

Dropped from the shortlist: **OpenAI Decisions API (`gpt-6-luna`).** Same request shape and
GA, but already measured in MAE-832 against Jev 1.13.0: faster (193 against 281 ms provider
call p50), selection accuracy 52.3% against 86.5%, overall pass 44.9% against 75.2%, and some
refused calls. It often hid instances the user asked to keep. Re-bench it periodically on the
same eval, since the model may improve.

Not a replacement but a prerequisite: **Jev 1.14.0.** Bench it against our pinned 1.13.0 first.
Any replacement should be judged against the better Jev.

Why not a chat LLM in the top 3: every chat candidate loses the calibrated confidence the
light tier gates on, needs the questions folded into one schema, and has no published TTFT.
The best of them (Cerebras `qwen-3.8-27b` with `reasoning_effort: none`, Groq `gpt-oss-20b`
strict, Haiku 5.5) deserve one ticket as a group, below.

## Recommended follow-up benchmark tickets

All of them should reuse the fixed test set on `ktrz/composed-planner-prototype`:
`apps/demo/prototype-mae826/composed-planner-eval.ts` with the expected results in
`results/light-tier-eval.txt` (30 intents, 13 light answers expected, 0 wrong allowed), plus
the router log from the journey runs (`results/raw/*.server.log`, `results/journey-results.md`).
Measure from both the Worker and the local server, since binding and HTTPS paths differ.

1. **MAE-849 (exists): Clef-flash against Jev.** Add Clef-omni as an extra arm, since it
   shares the binding and claims about 20 ms. Question: does Clef-flash or Clef-omni match
   13/13 with no wrong light answers at a lower median than Jev?
2. **Periodic re-bench of the OpenAI Decisions API against Jev.** Already measured once in
   MAE-832 (52.3% against 86.5% selection accuracy). Question: has the Decisions API closed the
   accuracy gap on the MAE-832 eval (`packages/evals`, suite `all`) and on the light-tier set?
6. **Jev 1.14.0 against Jev 1.13.0.** Question: does 1.14.0 match or beat 1.13.0 on accuracy
   and latency on the MAE-832 eval and the light-tier set, so we can move the pin before 1.13.0
   is deprecated?
3. **Clef (27B) as the accuracy fallback for Clef-flash.** Could fold into MAE-849 if it
   stays small. Question: does Clef fix any hand-off misses Clef-flash makes while staying
   under 300 ms on our prompt size?
4. **Constrained-decoding chat model as the decision model.** Arms: Cerebras `qwen-3.8-27b`
   (`reasoning_effort: none`), Groq `gpt-oss-20b` (strict schema), `claude-haiku-5-5` (low
   effort). Question: can a one-schema enum call reach 13/13 under 400 ms without a
   confidence score, and what gate replaces confidence?
5. **Embedding router for `ui_only` against `needs_tools`.** Question: does a nearest-example
   router on Workers AI `bge-m3` or `qwen3-embedding-0.6b` match Jev's routes on the journey
   log at a fraction of the latency?

Lower priority, no ticket yet: a local no-key stub using Kev-4B (same `/v1/systemone`
contract, runs on Apple Silicon) for offline development.

## Open questions

- Light tier prompt size is not logged. Add `usage.input_tokens` to the light tier's log line
  before benchmarking, since Clef-flash's hosted limit is 24,576 tokens and Clef's latency
  scales with input length.
- Clef-flash's low CLINC150+OOS score: does it show up as missed hand-offs on our
  `needs_screen_change` and `several_actions` cases?
- Clef-omni has no accuracy table. Its model page states no license terms.
- OpenAI Decisions API: context limit, streaming, and real latency are not stated. Does it
  accept `criteria`-style option descriptions with the same quality as Jev?
- Does `@tanstack/ai-cloudflare`'s `cloudflareDecider` accept Clef IDs, or only
  `typesafe/jev`? The docs name only Jev. A custom decider over `env.AI.run` is a few lines
  either way.
- Can the AI Gateway route `typesafe/jev` through the `env.AI` binding at no extra latency?
  That would make Jev against Clef an A/B with one binding.
- Haiku 5.5: whether thinking can be fully disabled was not verified (only effort control is
  documented on the model page).
- Logprob availability on `gpt-6-luna` chat and Haiku 5.5 was not verified.
- Cerebras and Groq developer tiers are labelled not for production. A production tier and
  price would be needed for the hosted demo.

## Sources

Repo (branch `ktrz/composed-planner-prototype`):
`apps/demo/src/server/keep-layout-action-planner.ts`, `apps/demo/src/server/agent-session.ts`,
`apps/demo/prototype-mae826/composed-planner-eval.ts`,
`apps/demo/prototype-mae826/results/light-tier-eval.txt`,
`apps/demo/prototype-mae826/results/journey-results.md`,
`apps/demo/prototype-mae826/results/raw/*.server.log`. Prior research:
`docs/research/loop-model-candidates.md` on `research/loop-model-candidates`.

Cloudflare:
- Workers AI model catalog: https://developers.cloudflare.com/workers-ai/models/
- Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Clef-flash: https://developers.cloudflare.com/workers-ai/models/clef-flash/
- Clef: https://developers.cloudflare.com/workers-ai/models/clef/
- Clef-omni: https://developers.cloudflare.com/workers-ai/models/clef-omni/
- Clairic: https://developers.cloudflare.com/workers-ai/models/clairic/
- Clef launch post: https://blog.cloudflare.com/clef-decision-models/
- Clef changelog: https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/
- Workers AI changelog (Clef-omni, price cut, speedup, retirements, AI Gateway unification):
  https://developers.cloudflare.com/changelog/product/workers-ai/
- JSON Mode: https://developers.cloudflare.com/workers-ai/features/json-mode/
- LoRA adapters: https://developers.cloudflare.com/workers-ai/features/fine-tunes/loras/
- Gemma 4 26B A4B: https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/
- Qwen 3.8 27B: https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/
- GLM-4.7-Flash: https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/
- bge-reranker-base: https://developers.cloudflare.com/workers-ai/models/bge-reranker-base/
- EmbeddingGemma 300m: https://developers.cloudflare.com/workers-ai/models/embeddinggemma-300m/

OpenAI:
- Decisions guide: https://developers.openai.com/api/docs/guides/decisions
- Decisions GA announcement (2026-10-22, OpenAI staff post):
  https://community.openai.com/t/decisions-api-is-now-generally-available-with-new-updates/1408934
- Models: https://developers.openai.com/api/docs/models
- Internal: MAE-832 Decisions against Jev results (planner-jev `openai-decisions-client.ts` on main,
  eval branch `ktrz/mae-832-decisions-evals`, commit `a1fb43d7`, run 2026-10-08).
- Jev 1.14.0 listing (release date, context, price): https://openrouter.ai/models/typesafe/jev-1.14
- Jev 1.14.0 availability: https://netlify.com/changelog/typesafe-jev-1-14-0-ai-gateway
  (feature and deprecation details come from secondary coverage, check docs.typesafe.ai).
- Structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Supervised fine-tuning (wind-down notice):
  https://developers.openai.com/api/docs/guides/supervised-fine-tuning

Anthropic:
- Models overview: https://platform.claude.com/docs/en/models/overview
- Haiku 5.5: https://platform.claude.com/docs/en/models/haiku-5-5/overview
- Structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs

Google:
- Models: https://aistudio.google.com/docs/models
- Pricing: https://aistudio.google.com/docs/pricing
- Gemini 3.5 Flash-Lite: https://aistudio.google.com/docs/models/gemini-3.5-flash-lite
- Gemini 3.1 Flash-Lite: https://aistudio.google.com/docs/models/gemini-3.1-flash-lite
- Thinking levels: https://aistudio.google.com/docs/thinking

Groq: https://console.groq.com/docs/models, https://console.groq.com/docs/structured-outputs

Cerebras: https://inference-docs.cerebras.ai/models/overview,
https://inference-docs.cerebras.ai/models/qwen-3.8-27b,
https://inference-docs.cerebras.ai/models/openai-oss,
https://inference-docs.cerebras.ai/capabilities/structured-outputs

SambaNova: https://docs.sambanova.ai/docs/en/models/sambacloud-models

Fireworks: https://fireworks.ai/pricing,
https://docs.fireworks.ai/structured-responses/structured-response-formatting

Together: https://www.together.ai/pricing, https://docs.together.ai/docs/json-mode

Mistral: https://docs.mistral.ai/getting-started/models/

TypeSafe Jev: https://typesafe.ai/

TanStack AI: https://tanstack.com/ai/latest/docs/getting-started/overview,
https://tanstack.com/ai/latest/docs/evaluate/evaluate,
https://tanstack.com/ai/latest/docs/adapters/cloudflare,
https://tanstack.com/ai/latest/docs/adapters/openai,
https://tanstack.com/ai/latest/docs/adapters/ollaya

Open decision models:
- Kev: https://github.com/jaredpalmer/kev, https://huggingface.co/jaredpalmer/kev-9b
- PostHog Jeeves: https://huggingface.co/PostHog/jeeves
- Ollaya and Laya: https://ollaya.dev/
- GLiNER2.5-Decide: https://huggingface.co/fastino/GLiNER2.5-Decide,
  https://fastino.ai/blog/gliner-2-5-decide-open-weight-decision-model

Other: semantic-router https://github.com/aurelio-labs/semantic-router, llama.cpp grammars
https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md
