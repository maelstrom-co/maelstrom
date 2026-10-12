# MAE-826 composed Planner and parallel tool calls: pet-food journey

PROTOTYPE (MAE-826): throwaway measurement, never merge.

Measured 2026-10-12 on branch `ktrz/composed-planner-prototype`, with the
Planner as the only path for UI changes (`AGENT_DIRECT_PUSH` unset).

## Setup

- Prompt (one turn): "Reorder my dog's usual food, but something lower in fat this time, and check out."
- Each run starts a fresh local `ws-server` (`run-journey.sh`) and drives it with the headless smoke
  (`prototype-mae825/agent-session-smoke.ts`): simulated `/shop` chart (orders, catalog, cart and
  checkout all visible), instant `agent.ui.applied` acks, `ask_user` auto-approved. Times exclude any
  browser render or human think time.
- Models: router TypeSafe Jev `jev-1.13.0` (`AGENT_ROUTER` default), loop `gpt-6-luna` effort low,
  LLM Planner `gpt-6-luna` effort low, light tier TypeSafe Jev `jev-1.13.0` (800 ms timeout).
- Configs, 3 runs each, interleaved A, B, C:
  - A: `AGENT_PLANNER=llm`, `AGENT_PARALLEL_TOOLS=0` (Planner-only baseline)
  - B: `AGENT_PLANNER=composed`, `AGENT_PARALLEL_TOOLS=0`
  - C: `AGENT_PLANNER=composed`, `AGENT_PARALLEL_TOOLS=1`
- Screen times are `[timing] ui.applied sinceInputMs`. "checkout" is the `place_order` change: the
  order placed and the confirmation shown, after the auto-approved `ask_user`.
- Tables come from `bun run prototype-mae826/parse-journey-logs.ts prototype-mae826/results/raw A-1 ... C-3`.
  Raw logs are in `raw/`.

## Per config (seconds since input: median [min-max])

| config | latest order | lower-fat options | cart | checkout | loop turns | loop turn ms (p50, max) | router ms (p50) | Planner calls light/llm | hand-off reasons | light tier ms (p50, max) | Planner call ms (p50, max) | queue wait ms (p50, max) | correct SKU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 5.7 [5.0-6.7] | 8.4 [7.7-9.4] | 11.4 [10.7-12.1] | 17.6 [15.8-18.4] | 5 [5-5] | 2077, 4775 | 267 | 0/12 | - | - | 2852, 3634 | 388, 2133 | 3/3 |
| B | 2.6 [2.4-3.9] | 5.7 [4.2-6.1] | 7.9 [7.7-9.5] | 9.4 [9.2-11.6] | 5 [5-6] | 1901, 3794 | 267 | 12/0 | - | 247, 308 | 122, 313 | 0, 0 | 3/3 |
| C | 2.4 [2.1-2.6] | 4.2 [3.7-4.6] | 6.2 [5.7-9.1] | 8.3 [7.9-11.5] | 5 [5-5] | 1859, 4702 | 277 | 12/0 | - | 247, 273 | 122, 274 | 0, 0 | 3/3 |

Light tier ms counts decision-model picks only. Required actions (`addToCart`, `placeOrder`) ship
in 0 to 3 ms with no model call, which is why the Planner call p50 is 122 ms.

## Per run

| run | latest order | lower-fat options | cart | checkout | loop turns | parallel tool turns | Planner calls (light/llm) | hand-offs | light ms | max queue wait | SKU added | ok |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-1 | 5.0 s | 7.7 s | 10.7 s | 15.8 s | 5 | 0 | 4 (0/4) | - | - | 1194 | DOG-DRY-SUMMIT-HW-30 | placed |
| A-2 | 5.7 s | 8.4 s | 11.4 s | 18.4 s | 5 | 0 | 4 (0/4) | - | - | 2133 | DOG-DRY-NORTHPAW-LEAN-28 | placed |
| A-3 | 6.7 s | 9.4 s | 12.1 s | 17.6 s | 5 | 0 | 4 (0/4) | - | - | 1675 | DOG-DRY-SUMMIT-HW-30 | placed |
| B-1 | 3.9 s | 6.1 s | 9.5 s | 11.6 s | 5 | 0 | 4 (4/0) | - | 308, 269 | 0 | DOG-DRY-NORTHPAW-LEAN-28 | placed |
| B-2 | 2.6 s | 5.7 s | 7.9 s | 9.4 s | 6 | 0 | 4 (4/0) | - | 247, 245 | 0 | DOG-DRY-SUMMIT-HW-30 | placed |
| B-3 | 2.4 s | 4.2 s | 7.7 s | 9.2 s | 5 | 0 | 4 (4/0) | - | 235, 246 | 0 | DOG-DRY-SUMMIT-HW-30 | placed |
| C-1 | 2.1 s | 3.7 s | 5.7 s | 8.3 s | 5 | 1 | 4 (4/0) | - | 233, 273 | 0 | DOG-DRY-SUMMIT-HW-30 | placed |
| C-2 | 2.4 s | 4.2 s | 6.2 s | 7.9 s | 5 | 1 | 4 (4/0) | - | 239, 253 | 0 | DOG-DRY-NORTHPAW-LEAN-28 | placed |
| C-3 | 2.6 s | 4.6 s | 9.1 s | 11.5 s | 5 | 1 | 4 (4/0) | - | 240, 256 | 0 | DOG-DRY-NORTHPAW-LEAN-28 | placed |

Every run added one lower-fat dry adult dog food from the similar list (Summit Trail Healthy
Weight 11% or Northpaw Lean 10%, against the usual 17%) and placed the order.

The light tier's 12 decision picks were all correct: `orders.showMostRecentOrder` for the latest
order (confidence 0.59 to 0.72) and `catalog.findSimilarProducts {sku: DOG-DRY-SUMMIT-ADULT-30,
lowerFatOnly: true}` for the lower-fat options (confidence 1.0). It never handed off on this journey.

## Where the time goes in config C, first two screens (ms since input)

| run | screen | router | loop (turns) | tool | held | queue wait | Planner | ack | visible at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C-1 | latest order | 270 | 1600 (1) | 1 | 0 | 0 | 238 | 1 | 2110 |
| C-1 | lower-fat options | 270 | 3183 (2) | 1 | 0 | 0 | 274 | 1 | 3729 |
| C-2 | latest order | 277 | 1821 (1) | 1 | 2 | 1 | 247 | 6 | 2355 |
| C-2 | lower-fat options | 277 | 3681 (2) | 1 | 0 | 0 | 268 | 2 | 4229 |
| C-3 | latest order | 326 | 1995 (1) | 0 | 1 | 0 | 245 | 1 | 2568 |
| C-3 | lower-fat options | 326 | 4057 (2) | 0 | 0 | 0 | 258 | 1 | 4642 |

"loop" runs from the router's decision to the tool's start and covers every loop model turn
before it. "held" is the wait between the tool's end and its show entering the Planner queue.

Medians: latest order = router 277 + one loop turn 1821 + Planner (light) 245 + about 3 ms of tool,
hold and ack = 2.4 s. Lower-fat options = router 277 + two loop turns 3681 + Planner (light) 268 =
4.2 s. Queue waits are 0: each light call (about 250 ms) finishes long before the next loop turn
(about 1.9 s) produces the next show. After the first screen, every later screen costs one loop
model turn plus a few hundred ms at most. The loop model is now the critical path.

Same breakdown in config A (LLM Planner): the first screen waits 2.8 to 3.6 s on the Planner, and the
lower-fat show waits 0.8 to 1.5 s in the queue behind the latest-order call before its own 2.7 s call.

## Parallel tool calls (B against C)

- No turns saved on this journey: both configs take 5 loop turns (B-2 took 6). The chain is serial
  by data: the past orders give the SKU, `find_similar_products` needs it, `add_to_cart` needs the
  pick, `place_order` follows.
- With the hint, the model used the parallel slot in every C run, always for `get_cart` next to
  `get_past_orders`. Without it, B-2 called `get_cart` in a turn of its own (6 turns, lower-fat
  options at 5.7 s); B-1 and B-3 never called it.
- C's medians are better (latest order 2.4 against 2.6 s, lower-fat 4.2 against 5.7 s), but loop turn
  medians are the same (1859 against 1901 ms). Most of the gap is B-1's slow first loop turn (3.3 s)
  and B-2's extra turn. With 3 runs each, treat the difference as noise apart from the avoided
  extra turn.
- Shows released in order: when tools of one phase queue several shows, the latest order goes
  first (`[timing] shows.release`). On this journey only one show per phase occurred.

## Two-part prompt on /shop, config C

Prompt: "Show my last order and also find cheaper alternatives." (`raw/twopart-C.*`)

- Router chose the tool loop. Turn 1 called `get_past_orders` and `search_products` in parallel.
  Shows released latest order first: the order was on screen at 3.3 s (light tier, 350 ms).
- The search show handed off to the LLM tier with `parameter_needs_generated_text` (the tool's free
  text `query`, "dog food cheaper alternatives", is not in the facts the light tier binds from) and
  landed at 7.8 s (4.5 s Planner call after a 0.4 s queue wait).
- Turn 2 issued two more parallel `search_products` calls (dog dry, indoor cat). Both handed off for
  the same reason, ran serially (4.2 and 4.8 s, the last waiting 4.8 s in the queue) and landed at
  12.0 and 16.8 s. The catalog shows one result set, so the cat search replaced the dog search on
  screen. Three catalog shows, two of them wasted.
- `search_products` has no price filter, so the reply said no cheaper alternatives were found.
- 3 loop turns, 2 of them parallel. The LLM tier's `userMessage` is in the future tense ("I'll
  update the catalog ...").

## Light tier eval after the side-effect fix

`composed-planner-eval.ts` with Jev, 30 intents (`light-tier-eval.txt`): 13/13 light answers
correct, 0 wrong light answers, 17/30 hand-offs (16 expected), light tier p50 248 ms, max 318 ms.
All 7 side-effect intents (add to cart, empty cart, place order) now hand off with
`side_effect_not_required`. The one miss is unchanged from before the fix: "Clear the search and
list the whole catalog" is read as two actions. The cases are the ones the light tier was tuned on,
so the accuracy is optimistic.

## Extra runs

`raw/trial-C.*` used "... and take me to checkout." instead: checkout was already visible, the
model added the item and stopped without placing the order or changing the screen, so that prompt
has no fourth screen change. Latest order 2.6 s, lower-fat options 4.5 s, cart 7.9 s.
