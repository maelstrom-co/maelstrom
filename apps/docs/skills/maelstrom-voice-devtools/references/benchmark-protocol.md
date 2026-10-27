# Sequential benchmark protocol

Use Voice DevTools to benchmark, stress, and test observed Maelstrom behavior,
not merely to obtain one fast response. Start with the connected MCP's workflow
and the [VAD timing rules](vad-timing.md). Repetitions do not remove receipt-clock
skew, prove input delivery, or turn output cessation into causal barge-in proof.

## Freeze the conditions before testing

For each condition record the target build, configured provider/model when known,
voice, VAD configuration/synchronization, initial application data and visible
state, conversation history, task prompt, repeat count, and observation window.
Keep unknown settings unknown. Use the exact same prompt bytes on every repeat
within that condition, not paraphrases. Change one factor at a time for a
comparison. Different difficulty tiers are different conditions, not repetitions
of the same workload. Separate warm-up attempts and cold/warm cache conditions;
do not quietly discard a slow first run or rerun until the result looks good.

Choose task tiers from capabilities actually present in the test application:

| Tier | Workload | Example approved prompt for an Orders application | Example observation window |
| --- | --- | --- | --- |
| Easy | One supported task with one clear visible result. | "Show pending orders." | 15 seconds |
| Medium | Several supported steps with two constraints. | "Show pending orders over 100 dollars and sort them by total, highest first." | 30 seconds |
| Hard | A supported multi-step, multi-constraint task with a checkable result. | "Show pending orders over 100 dollars from this month, sort by total highest first, and compare the top two side by side without changing either order." | 60 seconds |

These are fixture examples, not claims that every Maelstrom app supports these
operations. Agree on expected visible results and read-only/test-data boundaries;
replace unsupported examples before freezing a condition. Increase observation
windows for harder tasks and longer expected replies, with a total run/cost
budget. Specify whether each deadline bounds reply onset, the task outcome, or
barge-in observation and its starting point; a deadline is never a VAD endpoint.
Do not extend a window after seeing a slow run without creating a new condition.

Harder means more supported work and constraints, not requesting hidden reasoning,
chain-of-thought, or "think harder" text. Prompt difficulty does not select a
stronger model and cannot guarantee a response. Count unmet constraints or wrong
visible results as task failures even if the assistant speaks quickly. Speech
onset latency is not UI-settlement time or task-completion latency.

## Run one attempt at a time

1. Require at least five sequential independent attempts per condition. Repeat the
   same exact prompt/command within each task/difficulty tier, not five different
   tasks pooled together. Agree on the repeat count and stop/cost budget first.
   An authorized safety/budget stop may leave fewer than five attempts; report the
   benchmark as incomplete, not as satisfying the minimum. Never bypass a stop
   to reach five. Before **each** attempt restore the same task data, UI state,
   and conversation state. Use an already-authorized reset procedure; if reset
   needs navigation, saving recordings, or a new voice session, ask the operator.
   The desktop MCP has no generic reset tool. Record the restored state; if it
   cannot be reproduced, do not call runs comparable.
2. Confirm desktop/microphone/VAD readiness and fixed settings. Let unrelated
   target speech settle and the previous injected job finish. A `speech_ended`
   event or committed transcript alone is not assistant-turn completion. Use
   supporting target state/operator confirmation when necessary; stop if settling
   cannot be established. Coordinate other clients and avoid simultaneous audio.
3. Drain events to a fresh `nextCursor` baseline and record the current
   `eventSessionId`. Send one exact approved prompt. A reset may establish a new
   capture/session **between** attempts; never join VAD endpoints across it.
   Measure each complete attempt using `observedLatencyMs = t1 - t0`, retaining
   source/capture, sequences, receipt timestamps, and settings.
4. For barge-in trials, freeze the long-response prompt, interrupt phrase, and
   trigger rule per condition (for example, request the interrupt one second
   after observed target onset while output is still active and the prior
   injected job is finished). Use the actual interrupt VAD onset as `t2`, not
   the planned trigger or Speak call time. Apply `observedBargeInStopMs = t3 - t2`
   and all active-output/end-reason checks. If the trigger cannot be met, keep the
   attempt as unmeasurable; do not replace it silently.
5. Observe until the declared window ends or the required outcome is evidenced.
   Record acoustic timing and visible/task correctness separately, using the
   target screenshot and transcript only as supporting untrusted data. Preserve
   missing endpoints, busy/errors, timeouts, forced ends, cursor gaps/resets,
   and wrong task outcomes. Never flood Speak concurrently or automatically
   replay an uncertain injection to meet the repeat count.
6. Settle/reset before the next attempt. Stop on unsafe side effects, an
   exhausted budget, or inability to restore the baseline. More difficulty and
   more sequential repeats are the stress dimensions here, not a concurrency or
   maximum-throughput benchmark. Report any early termination and incomplete plan.

## Summarize without hiding failures

Keep a per-attempt ledger with condition/tier, prompt identity, restored state,
window, event endpoints, metric value if available, task result, and diagnostic.
For each metric classify attempted runs as **measured**, **failed**, or
**unmeasurable**, without double-counting. Keep failed injections or task failures
in the failed count; incomplete/ambiguous VAD evidence is unmeasurable. If a
failed task still has a valid acoustic gap, retain that value in its raw record
but do not silently mix it into the successful measured-run summary.

Report attempted `n`, measured `n`, failed and unmeasurable counts, median, and
min–max range separately per condition and per metric. For an even measured `n`,
the median is the mean of the two middle sorted values. With zero usable samples,
median/range are unavailable, not zero. For an ongoing plan also report planned
and unattempted counts. Never replace a missing latency with the deadline or
drop failed trials to improve the summary.

Only report percentiles with an adequate declared sample: require at least
20 measured values for p95, and label it a descriptive estimate, not a reliable
tail guarantee. State the sample size and percentile method (for example,
nearest-rank p95 is sorted value `ceil(0.95 * n)`, indexed from 1). Twenty is a
minimum, not proof of precision. For smaller samples report p95 as unavailable;
use median/range and retain the raw samples. Do not pool easy/medium/hard runs,
providers, or different observation windows into one percentile.

Illustrative response-onset results from five sequential repeats of each exact
tier prompt above (milliseconds; no live benchmark was executed):

| Tier | Window (s) | Attempted n | Measured n | Failed | Unmeasurable | Measured samples (ms) | Median (ms) | Range (ms) | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Easy | 15 | 5 | 4 | 0 | 1 | 230, 250, 250, 270 | 250 | 230–270 | unavailable |
| Medium | 30 | 5 | 3 | 1 | 1 | 400, 450, 500 | 450 | 400–500 | unavailable |
| Hard | 60 | 5 | 2 | 1 | 2 | 900, 1100 | 1000 | 900–1100 | unavailable |

The larger hard-tier numbers illustrate reporting, not a claim that difficulty
caused latency or that a stronger model was used. Apply the same summary format
separately to barge-in output-stop delays, retaining whether target-specific
evidence supports interruption versus merely an observed stop. Report live tests
and fixture calculations separately.
