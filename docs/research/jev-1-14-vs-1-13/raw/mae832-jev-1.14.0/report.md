# planner eval

- suite: all
- arms: jev-poc
- repeats: 3
- scenarios: 155
- llmModel: gpt-5.6-luna
- jevModel: jev-1.14.0
- date: 2026-11-08T08:27:58.902Z

## development

| Metric | jev-poc |
| --- | --- |
| Runs | 291 |
| Secondary judge (unvalidated) | Judge: 0 scored, 0 failed, 291 not run. disabled: 291. |
| Overall pass | 194/258 (75.2%) |
| Arrangement pass | 90/96 (93.8%) |
| Errors | 0 |
| Decisive turns pass | 121/167 (72.5%) |
| Decisive wins / losses vs baseline (paired) | 0 / 0 (0) |
| Expected deferrals at the right stage | 21/33 (63.6%) |
| Fallback rate | 121/291 (41.6%) |
| Fallbacks: jevActions/action_limit | 14 |
| Fallbacks: jevActions/action_unsupported | 65 |
| Fallbacks: jevLayout/layout_unavailable | 5 |
| Fallbacks: jevLayout/no_feasible_layout | 6 |
| Fallbacks: jevSelect/scope_ambiguous | 9 |
| Fallbacks: jevSelect/scope_unsupported | 22 |
| Selection accuracy | 199/236 (84.3%) |
| Actions accuracy | 154/172 (89.5%) |
| Layout accuracy | 131/164 (79.9%) |
| llmComplete fill rate | 12/12 (100.0%) |
| needsActions gate false positives / negatives | n/a |
| Spatial gate false positives / negatives | n/a (84 spatial, 24 controls) |
| Arrangement turns reaching jevLayout | 33/96 (34.4%) |
| Replayed stages | none |
| Turn latency p50 / p95 (ms) | 2623 / 5035 |
| jevSelect latency p50 / p95 (ms) | 208 / 253 |
| jevActions latency p50 / p95 (ms) | 472 / 1500 |
| jevLayout latency p50 / p95 (ms) | 169 / 199 |
| llmComplete latency p50 / p95 (ms) | 1256 / 1945 |
| Stage call latency p50 / p95 (ms) | 177 / 228 |
| LLM fallback call latency p50 / p95 (ms) | 2951 / 5383 |
| LLM complete call latency p50 / p95 (ms) | 1253 / 1939 |
| Stage calls / input / output tokens | 1137 / 3417820 / 408347 |
| Stage calls per turn | 3.91 |
| Stage tokens per turn (input / output) | 11745.1 / 1403.3 |
| LLM calls / input / output tokens | 291 / 709319 / 40059 |
| LLM fallback calls / input / output tokens | 121 / 664248 / 34003 |
| LLM complete calls / input / output tokens | 170 / 45071 / 6056 |
| LLM cache-read input tokens (reported calls / all calls) | 662527 (121 / 291) |
| LLM fallback cache-read input tokens (reported calls / all calls) | 662527 (121 / 121) |
| LLM complete cache-read input tokens (reported calls / all calls) | n/a (0 / 170) |
| LLM cache-write input tokens (reported calls / all calls) | 1358 (1 / 291) |
| LLM fallback cache-write input tokens (reported calls / all calls) | 1358 (1 / 121) |
| LLM complete cache-write input tokens (reported calls / all calls) | n/a (0 / 170) |
| LLM provider-reported cost (reported calls / all calls) | n/a (0 / 291) |
| LLM fallback provider-reported cost (reported calls / all calls) | n/a (0 / 121) |
| LLM complete provider-reported cost (reported calls / all calls) | n/a (0 / 170) |

## holdout

| Metric | jev-poc |
| --- | --- |
| Runs | 174 |
| Secondary judge (unvalidated) | Judge: 0 scored, 0 failed, 174 not run. disabled: 174. |
| Overall pass | 120/150 (80.0%) |
| Arrangement pass | 81/87 (93.1%) |
| Errors | 0 |
| Decisive turns pass | 50/71 (70.4%) |
| Decisive wins / losses vs baseline (paired) | 0 / 0 (0) |
| Expected deferrals at the right stage | 21/24 (87.5%) |
| Fallback rate | 102/174 (58.6%) |
| Fallbacks: jevActions/action_limit | 3 |
| Fallbacks: jevActions/action_unsupported | 76 |
| Fallbacks: jevLayout/layout_unavailable | 3 |
| Fallbacks: jevSelect/scope_ambiguous | 6 |
| Fallbacks: jevSelect/scope_unsupported | 12 |
| Fallbacks: llmComplete/retry_recommended | 2 |
| Selection accuracy | 130/150 (86.7%) |
| Actions accuracy | 72/76 (94.7%) |
| Layout accuracy | 53/73 (72.6%) |
| llmComplete fill rate | 3/3 (100.0%) |
| needsActions gate false positives / negatives | n/a |
| Spatial gate false positives / negatives | n/a (78 spatial, 12 controls) |
| Arrangement turns reaching jevLayout | 18/87 (20.7%) |
| Replayed stages | none |
| Turn latency p50 / p95 (ms) | 3098 / 4844 |
| jevSelect latency p50 / p95 (ms) | 207 / 254 |
| jevActions latency p50 / p95 (ms) | 193 / 872 |
| jevLayout latency p50 / p95 (ms) | 170 / 200 |
| llmComplete latency p50 / p95 (ms) | 1274 / 2273 |
| Stage call latency p50 / p95 (ms) | 179 / 230 |
| LLM fallback call latency p50 / p95 (ms) | 2997 / 4816 |
| LLM complete call latency p50 / p95 (ms) | 1271 / 2272 |
| Stage calls / input / output tokens | 560 / 1854758 / 203804 |
| Stage calls per turn | 3.22 |
| Stage tokens per turn (input / output) | 10659.5 / 1171.3 |
| LLM calls / input / output tokens | 176 / 580307 / 32174 |
| LLM fallback calls / input / output tokens | 102 / 561300 / 29792 |
| LLM complete calls / input / output tokens | 74 / 19007 / 2382 |
| LLM cache-read input tokens (reported calls / all calls) | 555846 (102 / 176) |
| LLM fallback cache-read input tokens (reported calls / all calls) | 555846 (102 / 102) |
| LLM complete cache-read input tokens (reported calls / all calls) | n/a (0 / 74) |
| LLM cache-write input tokens (reported calls / all calls) | 5148 (3 / 176) |
| LLM fallback cache-write input tokens (reported calls / all calls) | 5148 (3 / 102) |
| LLM complete cache-write input tokens (reported calls / all calls) | n/a (0 / 74) |
| LLM provider-reported cost (reported calls / all calls) | n/a (0 / 176) |
| LLM fallback provider-reported cost (reported calls / all calls) | n/a (0 / 102) |
| LLM complete provider-reported cost (reported calls / all calls) | n/a (0 / 74) |

## all

| Metric | jev-poc |
| --- | --- |
| Runs | 465 |
| Secondary judge (unvalidated) | Judge: 0 scored, 0 failed, 465 not run. disabled: 465. |
| Overall pass | 314/408 (77.0%) |
| Arrangement pass | 171/183 (93.4%) |
| Errors | 0 |
| Decisive turns pass | 171/238 (71.8%) |
| Decisive wins / losses vs baseline (paired) | 0 / 0 (0) |
| Expected deferrals at the right stage | 42/57 (73.7%) |
| Fallback rate | 223/465 (48.0%) |
| Fallbacks: jevActions/action_limit | 17 |
| Fallbacks: jevActions/action_unsupported | 141 |
| Fallbacks: jevLayout/layout_unavailable | 8 |
| Fallbacks: jevLayout/no_feasible_layout | 6 |
| Fallbacks: jevSelect/scope_ambiguous | 15 |
| Fallbacks: jevSelect/scope_unsupported | 34 |
| Fallbacks: llmComplete/retry_recommended | 2 |
| Selection accuracy | 329/386 (85.2%) |
| Actions accuracy | 226/248 (91.1%) |
| Layout accuracy | 184/237 (77.6%) |
| llmComplete fill rate | 15/15 (100.0%) |
| needsActions gate false positives / negatives | n/a |
| Spatial gate false positives / negatives | n/a (162 spatial, 36 controls) |
| Arrangement turns reaching jevLayout | 51/183 (27.9%) |
| Replayed stages | none |
| Turn latency p50 / p95 (ms) | 2812 / 4910 |
| jevSelect latency p50 / p95 (ms) | 208 / 253 |
| jevActions latency p50 / p95 (ms) | 324 / 1209 |
| jevLayout latency p50 / p95 (ms) | 170 / 200 |
| llmComplete latency p50 / p95 (ms) | 1264 / 1945 |
| Stage call latency p50 / p95 (ms) | 178 / 228 |
| LLM fallback call latency p50 / p95 (ms) | 2985 / 5204 |
| LLM complete call latency p50 / p95 (ms) | 1258 / 1939 |
| Stage calls / input / output tokens | 1697 / 5272578 / 612151 |
| Stage calls per turn | 3.65 |
| Stage tokens per turn (input / output) | 11338.9 / 1316.5 |
| LLM calls / input / output tokens | 467 / 1289626 / 72233 |
| LLM fallback calls / input / output tokens | 223 / 1225548 / 63795 |
| LLM complete calls / input / output tokens | 244 / 64078 / 8438 |
| LLM cache-read input tokens (reported calls / all calls) | 1218373 (223 / 467) |
| LLM fallback cache-read input tokens (reported calls / all calls) | 1218373 (223 / 223) |
| LLM complete cache-read input tokens (reported calls / all calls) | n/a (0 / 244) |
| LLM cache-write input tokens (reported calls / all calls) | 6506 (4 / 467) |
| LLM fallback cache-write input tokens (reported calls / all calls) | 6506 (4 / 223) |
| LLM complete cache-write input tokens (reported calls / all calls) | n/a (0 / 244) |
| LLM provider-reported cost (reported calls / all calls) | n/a (0 / 467) |
| LLM fallback provider-reported cost (reported calls / all calls) | n/a (0 / 223) |
| LLM complete provider-reported cost (reported calls / all calls) | n/a (0 / 244) |
