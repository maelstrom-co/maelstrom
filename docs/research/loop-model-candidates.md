# Loop model candidates for the Agent Session prototype

Ticket: ClickUp MAE-822 "Loop model candidates". Research date: 2026-10-08.
Models change weekly; every fact below carries its source and the date it was read.

## Question

Which fast models are competent at multi-step tool calling with acceptable
latency for an interactive UI loop (search catalog, read orders, add to cart,
set layout, finish), which of them `@tanstack/ai` can drive, and which models
did the 2026-10-06 meeting mean by "Jeff" and "Clef"?

## Short answer

- Try first: `claude-haiku-5-5`, `gpt-6-luna` (already wired in the demo), and
  `gemini-3.5-flash-lite` (Gemini adapter already installed). Keep a Cerebras-hosted
  open model (`qwen-3.8-27b` or `gpt-oss-120b`) as the speed ceiling test.
- "Jeff" is most likely **Jev** (TypeSafe), and "Clef" is almost certainly **Clef /
  Clef-flash** (Cloudflare, announced 2026-10-01). Both are decision models, not
  tool-calling chat models. They suit single-step routing inside the loop, not the
  loop itself.

## What the repo uses today

- Demo default is `gpt-6-luna` through `@tanstack/ai-openai`, registered with
  `extendAdapter(createOpenaiChat, [createModel(...)])`
  (`apps/demo/src/server/engine-model.ts`). `ENGINE_MODEL` env var overrides it.
- Installed versions (`bun.lock`): `@tanstack/ai` 0.43.1, `@tanstack/ai-openai`
  ^0.18.0, `@tanstack/ai-gemini` ^0.21.0. No Anthropic, Groq, Cloudflare or TypeSafe
  adapter is installed. Evals depend on `@tanstack/ai-openai` only.
- `packages/planner-jev` already calls TypeSafe directly
  (`https://api.typesafe.ai/v1/systemone`, key `TYPESAFE_API_KEY`, pinned model in
  `JEV_MODEL`, for example `jev-1.13.0`).

## Shortlist

Latency columns are the weakest evidence here. Treat vendor numbers as claims and
measure in the prototype. "AA" means Artificial Analysis.

| Model | Provider | Tool-calling evidence | Latency / speed | Price per 1M in/out | TanStack AI adapter | Parallel tool calls | Streaming tool calls |
|---|---|---|---|---|---|---|---|
| `claude-haiku-5-5` (released 2026-10-07) | Anthropic | Positioned for "subagent tasks", routing, extraction. Anthropic's launch page gives Terminal-Bench 4.0 39.2% and OSWorld 2.1 72.4%; it reports no tau-bench or BFCL. | Docs rank it "Fastest" in the lineup; no tokens/s or TTFT published. Customer claims only (Box: about half Haiku 4.5 latency). | $0.10 / $0.50 (up to 100k prompt) | Yes via `@tanstack/ai-anthropic` (not installed). Docs list Claude 4.x/5 ids; Haiku 5.5 not seen in the model list, so expect `extendAdapter`/`createModel` as done for Luna. | Supported by the Anthropic Messages API (not re-verified this run) | Not verified in TanStack docs |
| `claude-sonnet-5-5` | Anthropic | Same launch table: Terminal-Bench 4.0 70.6%, OSWorld 2.1 83.9%. Quality reference for the loop. | Docs: "Fast" | $2 / $10 | Yes, listed in `@tanstack/ai-anthropic` docs | As above | As above |
| `gpt-6-luna` | OpenAI | OpenRouter page (third party, unlabelled rows) shows TAU-Bench about 65 to 69% depending on provider. Anthropic's Haiku 5.5 page compares Luna at Terminal-Bench 4.0 16.4% (a competitor's table). | No official latency; none found | $0.10 / $0.50 | Yes, already in use | Not stated on OpenAI model page | Not verified |
| `gpt-6.1-sol` | OpenAI | "Near-Astra performance" per OpenAI; no loop benchmark found | None found | $2 / $10 | Yes (`@tanstack/ai-openai`) | Not stated | Not verified |
| `gemini-3.5-flash-lite` | Google | No tau2/BFCL score found | AA provider page (read 2026-10-08): about 490 tokens/s, 6.1 s time to first answer token on a 10k-token input workload; an AA comparison page shows 350 tokens/s and 7.2 s. Treat TTFT as poor-to-unknown without thinking disabled. | $0.30 / $2.50 | Yes, `@tanstack/ai-gemini` (installed) | Not verified | Not verified |
| `gemini-3.8-flash` | Google | No tool-calling score found | AA comparison (high reasoning): about 305 tokens/s, 13.4 s TTFT. High TTFT is largely reasoning time; low thinking settings not measured. | $0.75 / $3.75 until 2026-12-31, then $1.50 / $7.50 | Yes | Not verified | Not verified |
| `qwen-3.8-27b` | Cerebras (also Groq) | Cerebras docs: tool calling, parallel calls, multi-turn, strict mode supported. Groq lists parallel tool use "Yes". No third-party loop benchmark found. | Cerebras docs: about 1850 tokens/s. Groq docs: 450 tokens/s. | Groq: $0.80 / $4.00. Cerebras price not read. | Groq via `@tanstack/ai-groq`; Cerebras via `openaiCompatible` (TanStack docs say any OpenAI-compatible endpoint works) | Yes (both docs) | Not verified |
| `gpt-oss-120b` | Cerebras / Groq | Cerebras: tool calling, parallel, strict mode supported. Groq: tool use yes, **parallel tool use No**. | Cerebras about 3000 tokens/s; Groq 500 tokens/s | Groq: $0.15 / $0.60 | As above | Cerebras yes, Groq no | Not verified |
| `openai/gpt-oss-20b` | Groq | Groq: tool use yes, parallel no | 1000 tokens/s | $0.075 / $0.30 | `@tanstack/ai-groq` | No | Not verified |
| Jev (`jev-latest`, pin `jev-1.13.0`) | TypeSafe | Typed decisions only; no free-form tool calls found | Vendor: 70 to 500 ms; Cloudflare's table: median 524 ms | Vendor: $42 per billion input tokens | Yes, `@tanstack/ai-typesafe` (evaluate only) | n/a | n/a |
| Clef / Clef-flash | Cloudflare | Decision model. Cloudflare's own table lists BFCL 98.47 (Clef) / 98.76 (Clef-flash) / 95.75 (Jev); this is its decision-model adaptation, not the BFCL leaderboard. | Cloudflare blog: median 209.3 ms (Clef), 38.8 ms (Clef-flash); p95 122.4 ms for Clef-flash. Method not described. | Clef-flash $0.09 / 1M input, no output price | Yes, `@tanstack/ai-cloudflare` (Workers AI) | n/a | n/a |

Gaps worth knowing: no public tau2-bench or BFCL V4 number was retrievable for any
of the chat models above, and the BFCL leaderboard page returned no table when
fetched (page says last updated 2026-04-12). Parallel and streaming tool call
behaviour through `@tanstack/ai` was not verified in its docs; check the 0.43.1
source or test it in the prototype.

## Gotchas found

- OpenAI model pages for the GPT-6 family are reported (third party aggregators) to
  allow function calling on Chat Completions only with reasoning effort `none`; other
  efforts need the Responses API. The demo uses `createOpenaiChat`. Verify before
  relying on tools with Luna. Not confirmed from OpenAI's own page in this run.
- Haiku 5.5 uses the newer tokenizer: the same text counts as about 30% more tokens
  than on Haiku 4.5 (Anthropic model page, 2026-10-08).
- Gemini 3.8 and 3.7 Flash prices double on 2027-01-01 (Google pricing page).
- Haiku 5.5 is one day old and Jev/Clef are one to two weeks old. Expect churn.

## Recommendation: first three to try

1. **`claude-haiku-5-5`** (Anthropic). Fastest in Anthropic's lineup, built for
   subagent work, same price as Luna, and the strongest Terminal-Bench/OSWorld
   numbers among the cheap tier on Anthropic's own table (vendor evidence). Needs
   `@tanstack/ai-anthropic` added and the model registered with `createModel`. Use
   `effort` low/medium to control TTFT.
2. **`gpt-6-luna`** (OpenAI). Zero integration cost, already the demo default, same
   price. Baseline for the loop. Confirm the reasoning-effort and API-surface
   constraint on tools first.
3. **A fast host, `qwen-3.8-27b` on Cerebras** (fallback `gpt-oss-120b` on Cerebras,
   because Groq's gpt-oss lacks parallel tool use). Highest published tokens/s
   (about 1850), documented parallel tool calls and strict mode. This answers the
   "partial UI in 1 to 2 s" question and sets the latency floor. Reach it through
   `openaiCompatible` or `@tanstack/ai-groq` to avoid a new adapter.

Also run `gemini-3.5-flash-lite` as a cheap fourth since the adapter is installed,
but its published TTFT (about 6 s) looks poor for this loop unless thinking can be
turned down; measure before investing.

Measure per step in the prototype: TTFT, time to first complete tool call, steps to
finish, and tool-argument validity. Do not trust the table above for those.

## "Jeff" and "Clef": findings (guesses, labelled)

- **Jeff = Jev (high confidence, a guess about the transcript).** `Jev` is TypeSafe's
  model and `packages/planner-jev` is already in this repo. It answers typed
  multiple-choice questions fast and writes no text (`packages/planner-jev/README.md`;
  typesafe.ai describes it as a "System One Model" that returns typed decisions with
  probabilities, in early access, read 2026-10-08).
- **Clef = Cloudflare Clef (high confidence, a guess about the transcript).** Cloudflare
  announced "Clef" and "Clef-flash" on 2026-10-01 (blog.cloudflare.com/clef-decision-models,
  developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai). They are open-weight
  (Apache 2.0) decision models on Workers AI, API-compatible with Jev, Clef-flash
  `@cf/cloudflare/clef-flash` (9B) and Clef (27B), 64K context. The Register (2026-10-01)
  frames Clef as Cloudflare's answer to Jev, and notes the benchmark numbers are
  self-reported.
- Phonetic fit: "Jeff" to "Jev" and "Clef" to "Clef" are both consistent with a
  meeting about decision models announced within the same week. I did not read the
  meeting transcript, so this is inference, not confirmation. Chris or the meeting
  notes should confirm.
- **Implication.** Neither is a drop-in loop model. Both return a probability per
  allowed option for typed questions, with no free-form tool arguments or text. They
  fit as a router inside the loop (which tool next, is the request supported, which
  layout candidate), which is how `planner-jev` already uses Jev. Clef-flash at
  about 39 ms median (vendor claim) versus Jev at about 524 ms (Cloudflare's measurement)
  is worth an A/B in the same slot, with the caveat that Cloudflare benchmarked its
  own model.

## Sources (all read 2026-10-08)

- OpenAI models: https://developers.openai.com/api/docs/models
- Anthropic models overview: https://platform.claude.com/docs/en/models/overview
- Claude Haiku 5.5 page: https://platform.claude.com/docs/en/models/haiku-5-5/overview
- Claude Haiku 5.5 announcement: https://www.anthropic.com/claude-haiku-5-5
- Gemini models and pricing: https://ai.google.dev/gemini-api/docs/models and https://ai.google.dev/gemini-api/docs/pricing
- Artificial Analysis (Gemini 3.5 Flash-Lite, 3.8 Flash comparison pages), via search results
- Groq models and tool use: https://console.groq.com/docs/models, https://console.groq.com/docs/tool-use
- Cerebras models and tool use: https://inference-docs.cerebras.ai/models/overview, https://inference-docs.cerebras.ai/capabilities/tool-use
- TanStack AI overview and adapters: https://tanstack.com/ai/latest/docs/getting-started/overview, /docs/adapters/openai, /docs/adapters/anthropic, /docs/adapters/typesafe
- Cloudflare Clef: https://blog.cloudflare.com/clef-decision-models/, https://developers.cloudflare.com/workers-ai/models/clef-flash/
- The Register on Clef: https://www.theregister.com/ai-and-ml/2026/10/01/cloudflare-tries-to-outplay-jev-with-open-weight-clef-models/5300649
- TypeSafe Jev: https://typesafe.ai/
- BFCL leaderboard page (no table retrieved): https://gorilla.cs.berkeley.edu/leaderboard.html
- OpenRouter GPT-6 Luna page (third party): https://openrouter.ai/models/openai/gpt-6-luna-20260922
- Repo: `apps/demo/src/server/engine-model.ts`, `packages/planner-jev/README.md`, `bun.lock`
