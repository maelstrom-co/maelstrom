# Trigger-word developer checks

Use this checklist to validate what a person hears and what the actual providers
accept. Automated event mocks cannot establish STT accuracy, response-reference
compatibility, truncation delivery, or browser audibility. **Both provider runs
are pending until a developer records the results after being notified.** Do not
run paid provider calls automatically or put credentials/transcripts in reports.

## Prepare each run

- Record revision, date, tester, browser/OS, microphone/audio route, provider/model,
  and worker version (LiveKit). Record Pass, Fail, or Not tested for each check,
  with redacted observations. Do not claim overall acceptance with required
  cells missing. Recheck after any relevant implementation change.
- Use consenting participants and non-sensitive scripted phrases. Explain that
  capture remains active while waiting and accepted speech can reach provider
  STT and incur usage. Waiting is not mute or erasure. Confirm the visible
  AI-generated-voice disclosure before starting.
- OpenAI local entry point: `bun --cwd apps/demo run dev` from the repository
  root with existing development credentials. No new key should be committed.
- LiveKit local entry point: `bun --cwd apps/demo run dev-livekit` with the
  updated worker, LiveKit, Deepgram, and Cartesia configured privately. Confirm
  the worker joins as a server-designated agent participant. Do not deploy for
  this check.
- Observe adapter events locally using a debugger or approved redacted test
  harness. Retain event types, ordering, counts, and diagnostic categories only;
  never save raw credentials, audio, complete payloads, or real-user text. Some
  adversarial ordering/failure cases need deliberate local test instrumentation,
  not network throttling alone. Mark unavailable cases Not tested, not Pass.

## UI and compatibility — run for both providers

1. Fresh load starts Normal. Confirm the existing fixed greeting once, manual or
   automatic controls unchanged, ordinary typed submission unchanged, and no
   trigger required. Stop and reconnect; retained greeting proof does not replay.
2. Stop, open Voice settings with the keyboard, choose Trigger phrase, and apply
   `hello maelstrom`, 10 seconds, chat off. Confirm labelled fields, focus, bounds,
   and helpful validation for empty/punctuation-only or over-200-code-point
   phrases and out-of-range/fractional-millisecond durations. Switching back to
   Normal preserves normal greeting semantics, without a synthetic Skip record.
3. Start with a direct click: microphone permission and audio unlocking must work.
   While connected/connecting, settings cannot be changed and say “Stop voice to
   change settings.” The panel must not move the dock or resize the Chart. Off
   and error labels take precedence over retained Waiting policy.
4. In browser-key mode, type before entering credentials, save the key, and
   confirm exactly one resumed submission and working gesture-unlocked voice.
   Change/remove the key: old session work is retired, accepted settings and
   draft survive, and no old token/held voice request affects the new session.

## Matching and private holding — run for both providers

1. While Waiting, speak unrelated words and a command. Expect no response, tool,
   Engine intent, application caption/history, greeting, or interruption. STT
   provider traffic is expected and is not evidence of admission.
2. Say the standalone phrase with varied case/punctuation as transcribed:
   `Hello, Maelstrom!` and `hello-maelstrom` should match. Reject joined words,
   repeated phrases, interim-only text, and `hello maelstrom, show weather` in
   one finalized turn. Test a custom accented phrase and `can't`/`can’t` versus
   `cant`; separate speech-recognition errors from matcher behavior.
3. A successful trigger enters Active without greeting or action. Speak a
   separate request after it; expect one admitted request. Try speaking that
   separate request during a delayed activation hook: no visible caption,
   response, or interruption before Active, then ordinary scheduling afterwards.
4. With local event-delay instrumentation, deliver request N+1's final before
   trigger N's final and delay source metadata. Verify source-order release,
   not final-arrival/UI-time admission. Earlier or overlapping input remains
   excluded. With LiveKit, include transported pre-roll overlap. Ambiguous or
   missing evidence must not be guessed into admission.
5. Repeat with activation hook resolution, rejection, and a never-settling hook.
   Admission waits at most two seconds; failures warn by category only. Observe
   the AbortSignal on timeout/Stop. A late hook resolution cannot revive a
   stopped/replacement connection or replay held input.
6. Finish a wake, let it expire, then deliver duplicate/late old trigger or
   request results. They must not wake or release work in a later epoch.

## Full-turn inactivity and chat — run for both providers

1. Request a response longer than 10 seconds. Listen through its end. The timer
   starts only after speech, STT, Engine/tools/render, follow-ups, and playback
   signals finish. Expiry does not shorten, clear, mute, cancel, or disconnect it.
   Correlate signal timing with what is actually audible; report any mismatch.
2. Start new work just before expiry and during a delayed deactivation hook.
   Active admission remains, the hook signal aborts, and a fresh full idle
   interval starts after that work. Test rejected/timed-out deactivation too.
3. Intentionally interrupt an Active response. Existing admitted-user barge-in
   still works. Waiting/held/excluded speech cannot interrupt. For OpenAI test
   both immediate and transcript-confirmed policies; noise alone is not a
   reliable acoustic acceptance test.
4. Suppress a playback-terminal signal in the local harness. Voice must stay
   Active rather than invent a completion timeout. Stop voice still works.
5. With chat off, type a long request: it does not extend voice activity or wake
   Waiting. Stop, enable chat, restart: a typed request keeps an Active session
   busy through response **and render settlement**, including errors. Text
   containing the trigger never wakes voice.
6. Start enabled chat while Waiting, then speak the trigger. Its token survives
   that wake and prevents idle expiry until completion. Overlap two typed
   requests using the host harness; finishing one cannot finish the other.
   Stop/reconnect before a completion; stale completion cannot release new work.
   Exercise direct Send and the credential-resumed path.

## OpenAI-specific runtime contract

- Verify initial publication waits for matching transcription/VAD configuration
  acknowledgement. Missing/mismatched ACK or transcription disabled fails closed
  under its setup bound; it does not fall back to unsafe capture/automatic
  response generation. An ACK is not a global audio/event drain.
- On a real connection, inspect every response and tool follow-up: explicit
  `conversation: 'auto'` and ordered `item_reference` input must contain only
  live admitted user audio, current acknowledged grounding, and owned completed
  assistant/function items. Confirm the provider accepts these actual references
  and echoes the response correlation metadata required by the adapter.
- Ask for a UI/tool change, then refer to its result. Confirm function call and
  function-output references are valid, the output ACK precedes follow-up, and
  grounding replacement does not delete an in-flight reference prematurely.
- Let voice return to Waiting and wake again. Refer to admitted earlier dialogue:
  it survives in the same connection with no remint/reset. Excluded waiting
  speech must not contaminate the next explicit response input.
- Interrupt assistant audio and inspect provider-confirmed truncation. Subsequent
  references use the retained state and do not reintroduce unheard local text.
- Confirm deletion of completed historical items with provider acknowledgements.
  Later explicit inputs omit those references and any dependent invalidated
  call/output groups while preserving the remaining admitted dialogue. This alone
  must not cause an eligibility error or a per-wake reset; no local history-trimming
  algorithm should run.
- Separately test missing required/current references, deletion of an in-flight
  snapshot reference, provider reference rejection, and late output metadata that
  attempts to resurrect a deleted item. Also test unresolved ACKs and
  incomplete/failed responses. Expect explicit eligibility errors within the
  applicable bounds, no default-history retry or silent dialogue reset. Record
  actual provider behavior, not just a mock event sequence.
- Distinguish `response.done` from correlated output-buffer completion. A response
  ending generation while audio continues must keep playback activity owned.

## LiveKit-specific runtime contract

- Verify correlated-turn negotiation succeeds only with the updated agent
  participant. An old/absent worker times out within five seconds before capture.
  Wrong-participant/wrong-nonce data cannot wake or settle playback; losing the
  pinned participant fails closed rather than accepting a replacement implicitly.
- Test successful full-drain finals, empty turn followed by trigger, no handler,
  failed drain with partial trigger text, cancelled/misfire, released successor,
  and duplicate turn-end/result. Only a successful whole final can wake. No
  duplicate intent may arrive through legacy transcription.
- Delay a terminal past the worker drain budget plus five seconds. Observe an
  explicit failure, not a late wake. Replace the track/connection and replay an
  old result locally; it must be inert.
- Confirm original pre-roll, turn FIFO and tail drain still work for automatic
  speech. Force safe VAD degradation or configure manual mode: hold/release for
  the trigger, then hold/release for a separate request. No second planner or
  continuous recognition path should appear.
- Correlate each `tts_done`/error/cancel with its own utterance. Old/id-less
  terminals cannot settle new playback. Listen on the receiving browser:
  worker source drain is not remote audibility, and expiry cannot mute residual
  buffered audio.

## Record and notify

- OpenAI result: **Not tested**.
- LiveKit result: **Not tested**.
- Acoustic/device coverage: **Not tested**.
- Tester/date/revision and redacted evidence location: **Pending**.

After implementation notification, the developer runs and records both provider
checks. Failures route to a bounded fix and fresh affected verification. Do not
replace these pending entries with automated test/build results.
