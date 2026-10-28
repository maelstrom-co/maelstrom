# VAD timing and examples

## Clock and event rules

Use the connected server's `get_workflow` and schemas as the current contract.
These examples use `get_events` journal entries: outer `type`, `sequence`, UTC
`timestamp`, `captureId`, and nested `data`. Retain the event-session ID from
`get_state` and advance each independent polling cursor with `nextCursor`.
Drain `hasMore` before waiting again. A `gap` or `reset` invalidates a measurement;
start a new baseline instead of joining events across missing history or restarts.

| Audio in the diagrams | VAD source | Association and limits |
| --- | --- | --- |
| Input (injected speech) | `desktop_app` | Virtual transmit monitor before host microphone-delivery gating. `captureId` is null; no `jobId`. It cannot prove delivery to the target. |
| Output (website playback) | `target_app` | Captured website audio, identified by outer `captureId` and `data.id`. Keep one capture throughout the measurement. |

Use the **outer journal receipt `timestamp`** for both endpoints and convert UTC
values to milliseconds before subtracting. Do not use the time a tool call
returns, transcript timestamps, or Speak acceptance/completion as speech edges.
Order journal delivery by `sequence`; identify the relevant acoustic segment from
the controlled experiment, not just the next event of the other source. There is
no automatic request/response pairing. Do not use a fabricated job ID to join
`desktop_app` VAD to Speak. Allow only one injected utterance at a time and exclude
other clients/manual injections and unrelated target audio.

The sources share the host receipt clock, not a sample-synchronized audio clock.
Default onset confirmation is two positive 32 ms windows (about 64 ms), and end
confirmation is 16 consecutive negative windows (about 512 ms). Buffering and
worker/bridge scheduling introduce additional skew. Inspect the actual
`vadConfig`, `vadConfigSynchronized`, and `vadConfigError` when exposed; settings
can change live. Keep settings fixed for a test and report uncertainty if they
are unsynchronized. Do not subtract a fixed 512 ms to claim a corrected latency.

Optional `data.boundaryOffsetMs` estimates a separately padded boundary relative
to the confirming inference-window end; `data.streamOffsetMs` is relative to that
source stream's origin. Default pre/post padding is 60 ms and changes estimated
boundaries, not event-delivery delay. These fields do not replace receipt times
or synchronize the sources. Never subtract `streamOffsetMs` across sources or
mix receipt and boundary-adjusted endpoints in one metric. The calculations below
are explicitly receipt-clock observations, even when boundary offsets exist.

## Response-onset latency: t1 - t0

```text
Time ->
Input  (desktop_app): ~~~~~~~t0
Output (target_app):              t1~~~~~~~~
                               |--|
                               gap (schematic, not to scale)
```

`t0` is the input utterance's `desktop_app` / `speech_ended`, with reason
`silence`. `t1` is the observed reply's `target_app` / `speech_started` in the
selected capture. The metric starts at **input end**, not input start or the
Speak request time:

```text
observedLatencyMs = epochMilliseconds(t1.timestamp) - epochMilliseconds(t0.timestamp)
```

Example excerpt from the `events` array (illustrative, not a live result):

```json
[
  {"sequence":101,"timestamp":"2026-10-23T12:00:00.000Z","captureId":null,"type":"vad","data":{"type":"vad","source":"desktop_app","state":"speech_started"}},
  {"sequence":102,"timestamp":"2026-10-23T12:00:01.600Z","captureId":null,"type":"vad","data":{"type":"vad","source":"desktop_app","state":"speech_ended","reason":"silence"}},
  {"sequence":103,"timestamp":"2026-10-23T12:00:01.850Z","captureId":"capture-1","type":"vad","data":{"type":"vad","source":"target_app","id":"capture-1","state":"speech_started"}},
  {"sequence":104,"timestamp":"2026-10-23T12:00:03.450Z","captureId":"capture-1","type":"vad","data":{"type":"vad","source":"target_app","id":"capture-1","state":"speech_ended","reason":"silence"}}
]
```

Here `t0` is sequence 102 and `t1` is 103: `1,850 - 1,600 = 250 ms`, an
**approximate observed response-onset gap**. The input start/end pair establishes
which utterance ended; the job result alone cannot do that. Verify target output
was quiet before this experiment and the onset is plausibly its reply, using the
controlled prompt and supporting transcript when available.

A target onset can arrive before the input end event because of silence hangover,
audio overlap, or delivery skew. Preserve the signed gap if the segment pairing
is clear; label a negative value as overlap/skew, not negative processing time.
Never clamp to zero, swap endpoints, or search for a later onset just to get a
positive number. If the reply association is unclear, report **unmeasurable**.

## Barge-in effect: t3 - t2

```text
Time ->
Input  (desktop_app): ~~~~~t0          t2~~~~~~~
Output (target_app):          t1~~~~~~~~~~~~t3
                                     |-----|
                                     observed stop delay
```

`t0` and `t1` establish the initial exchange as above. After the initial injected
job completes, while the target output segment that began at `t1` is still
active, call `speak({"text":"Stop, let me ask something else."})` if that phrase
is authorized. `t2` is the **new input start**, `desktop_app` / `speech_started`;
`t3` is the **same active output segment's end**, `target_app` / `speech_ended`.
Do not wait for the remote assistant's turn to finish before attempting the
interrupt, and do not wait for the interrupt input to end to start the metric:

```text
observedBargeInStopMs = epochMilliseconds(t3.timestamp) - epochMilliseconds(t2.timestamp)
```

Example excerpt from the `events` array (illustrative, not a live result):

```json
[
  {"sequence":201,"timestamp":"2026-10-23T12:00:10.000Z","captureId":null,"type":"vad","data":{"type":"vad","source":"desktop_app","state":"speech_started"}},
  {"sequence":202,"timestamp":"2026-10-23T12:00:11.500Z","captureId":null,"type":"vad","data":{"type":"vad","source":"desktop_app","state":"speech_ended","reason":"silence"}},
  {"sequence":203,"timestamp":"2026-10-23T12:00:11.800Z","captureId":"capture-2","type":"vad","data":{"type":"vad","source":"target_app","id":"capture-2","state":"speech_started"}},
  {"sequence":204,"timestamp":"2026-10-23T12:00:13.000Z","captureId":null,"type":"vad","data":{"type":"vad","source":"desktop_app","state":"speech_started"}},
  {"sequence":205,"timestamp":"2026-10-23T12:00:13.720Z","captureId":"capture-2","type":"vad","data":{"type":"vad","source":"target_app","id":"capture-2","state":"speech_ended","reason":"silence"}},
  {"sequence":206,"timestamp":"2026-10-23T12:00:13.900Z","captureId":null,"type":"vad","data":{"type":"vad","source":"desktop_app","state":"speech_ended","reason":"silence"}}
]
```

Here `t2` is sequence 204 and `t3` is 205: `13,720 - 13,000 = 720 ms`, an
**approximate observed barge-in output-stop delay**. Pair target start 203 with
end 205 in `capture-2`, not with a new response after the interrupt. Speak's
accepted interrupt job is only submission evidence; input VAD onset is `t2`.

Check the target was already speaking at `t2`: an observed target start without
an intervening end is necessary, but VAD hangover can keep a segment active after
audio has gone quiet. Use a deliberately long reply and supporting observations;
if output had already ended or the association is uncertain, discard the trial.
A pause or natural reply completion can also produce `t3`. Cessation after `t2`
alone does not prove the input caused it. Report the observed delay separately
from whether target-specific evidence supports successful interruption. There is
no MCP remote-stop command; the second utterance attempts acoustic barge-in
through the synthetic microphone, and the target decides how to respond.

## Reject incomplete or contaminated measurements

- Use `reason: "silence"` for detected quiet ends. `capture_stopped`, `replaced`,
  or `interrupted` are forced boundaries, not evidence of an acoustic response or
  successful barge-in. Report the reason and mark the corresponding metric
  unmeasurable. Do not stop capture to generate `t3`.
- Discard the trial for a cursor `gap`/`reset`, changed event session/capture,
  detector errors (including `vad_failed`), missing starts/ends, ambiguous input
  association, or a clock rollback/inconsistent timeline. Do not join old and new
  captures or infer missing events from transcripts.
- If no target onset or stop is observed before the agreed deadline, report
  **not observed within the observation window**, with the missing endpoint;
  do not invent a latency or treat the deadline as `t1`/`t3`.
- Committed transcripts and VAD ends do not establish assistant-turn completion.
  Continue observation when the test concerns resumed speech or semantic outcome.

For each result retain the endpoint sequences, source/capture identifiers,
original timestamps, metric and units, VAD configuration, observation window, and
limitations. Keep sensitive transcripts/screenshots out of reports unless the
user authorized them. Numeric examples and structural tests demonstrate the
calculation, not a successful live microphone or provider trial.
