# planner eval

- suite: all
- arms: jev-poc
- repeats: 3
- scenarios: 155
- llmModel: gpt-5.6-luna
- jevModel: jev-1.13.0
- date: 2026-11-08T08:03:53.248Z

## development

| Metric | jev-poc |
| --- | --- |
| Runs | 291 |
| Secondary judge (unvalidated) | Judge: 0 scored, 0 failed, 291 not run. disabled: 291. |
| Overall pass | 195/258 (75.6%) |
| Arrangement pass | 90/96 (93.8%) |
| Errors | 0 |
| Decisive turns pass | 121/167 (72.5%) |
| Decisive wins / losses vs baseline (paired) | 0 / 0 (0) |
| Expected deferrals at the right stage | 24/33 (72.7%) |
| Fallback rate | 123/291 (42.3%) |
| Fallbacks: jevActions/action_limit | 11 |
| Fallbacks: jevActions/action_unsupported | 67 |
| Fallbacks: jevLayout/layout_unavailable | 3 |
| Fallbacks: jevLayout/no_feasible_layout | 6 |
| Fallbacks: jevSelect/scope_ambiguous | 12 |
| Fallbacks: jevSelect/scope_unsupported | 24 |
| Selection accuracy | 201/237 (84.8%) |
| Actions accuracy | 156/170 (91.8%) |
| Layout accuracy | 134/167 (80.2%) |
| llmComplete fill rate | 12/12 (100.0%) |
| needsActions gate false positives / negatives | n/a |
| Spatial gate false positives / negatives | n/a (84 spatial, 24 controls) |
| Arrangement turns reaching jevLayout | 34/96 (35.4%) |
| Replayed stages | none |
| Turn latency p50 / p95 (ms) | 2665 / 4793 |
| jevSelect latency p50 / p95 (ms) | 209 / 267 |
| jevActions latency p50 / p95 (ms) | 365 / 1317 |
| jevLayout latency p50 / p95 (ms) | 170 / 215 |
| llmComplete latency p50 / p95 (ms) | 1258 / 2090 |
| Stage call latency p50 / p95 (ms) | 182 / 240 |
| LLM fallback call latency p50 / p95 (ms) | 2909 / 5113 |
| LLM complete call latency p50 / p95 (ms) | 1256 / 2089 |
| Stage calls / input / output tokens | 1086 / 3348510 / 396099 |
| Stage calls per turn | 3.73 |
| Stage tokens per turn (input / output) | 11506.9 / 1361.2 |
| LLM calls / input / output tokens | 291 / 720667 / 42340 |
| LLM fallback calls / input / output tokens | 123 / 676341 / 35903 |
| LLM complete calls / input / output tokens | 168 / 44326 / 6437 |
| LLM cache-read input tokens (reported calls / all calls) | 593531 (122 / 291) |
| LLM fallback cache-read input tokens (reported calls / all calls) | 593531 (122 / 123) |
| LLM complete cache-read input tokens (reported calls / all calls) | n/a (0 / 168) |
| LLM cache-write input tokens (reported calls / all calls) | 82441 (42 / 291) |
| LLM fallback cache-write input tokens (reported calls / all calls) | 82441 (42 / 123) |
| LLM complete cache-write input tokens (reported calls / all calls) | n/a (0 / 168) |
| LLM provider-reported cost (reported calls / all calls) | n/a (0 / 291) |
| LLM fallback provider-reported cost (reported calls / all calls) | n/a (0 / 123) |
| LLM complete provider-reported cost (reported calls / all calls) | n/a (0 / 168) |

## holdout

| Metric | jev-poc |
| --- | --- |
| Runs | 174 |
| Secondary judge (unvalidated) | Judge: 0 scored, 0 failed, 174 not run. disabled: 174. |
| Overall pass | 124/150 (82.7%) |
| Arrangement pass | 82/87 (94.3%) |
| Errors | 0 |
| Decisive turns pass | 58/78 (74.4%) |
| Decisive wins / losses vs baseline (paired) | 0 / 0 (0) |
| Expected deferrals at the right stage | 21/24 (87.5%) |
| Fallback rate | 96/174 (55.2%) |
| Fallbacks: jevActions/action_limit | 3 |
| Fallbacks: jevActions/action_unsupported | 69 |
| Fallbacks: jevLayout/layout_unavailable | 5 |
| Fallbacks: jevSelect/scope_ambiguous | 6 |
| Fallbacks: jevSelect/scope_unsupported | 13 |
| Selection accuracy | 135/149 (90.6%) |
| Actions accuracy | 77/83 (92.8%) |
| Layout accuracy | 64/78 (82.1%) |
| llmComplete fill rate | 3/3 (100.0%) |
| needsActions gate false positives / negatives | n/a |
| Spatial gate false positives / negatives | n/a (78 spatial, 12 controls) |
| Arrangement turns reaching jevLayout | 20/87 (23.0%) |
| Replayed stages | none |
| Turn latency p50 / p95 (ms) | 3024 / 4854 |
| jevSelect latency p50 / p95 (ms) | 210 / 260 |
| jevActions latency p50 / p95 (ms) | 204 / 881 |
| jevLayout latency p50 / p95 (ms) | 175 / 228 |
| llmComplete latency p50 / p95 (ms) | 1289 / 2456 |
| Stage call latency p50 / p95 (ms) | 188 / 241 |
| LLM fallback call latency p50 / p95 (ms) | 3069 / 5338 |
| LLM complete call latency p50 / p95 (ms) | 1285 / 2453 |
| Stage calls / input / output tokens | 573 / 1869842 / 205941 |
| Stage calls per turn | 3.29 |
| Stage tokens per turn (input / output) | 10746.2 / 1183.6 |
| LLM calls / input / output tokens | 174 / 549302 / 31661 |
| LLM fallback calls / input / output tokens | 96 / 529306 / 28677 |
| LLM complete calls / input / output tokens | 78 / 19996 / 2984 |
| LLM cache-read input tokens (reported calls / all calls) | 466615 (96 / 174) |
| LLM fallback cache-read input tokens (reported calls / all calls) | 466615 (96 / 96) |
| LLM complete cache-read input tokens (reported calls / all calls) | n/a (0 / 78) |
| LLM cache-write input tokens (reported calls / all calls) | 62403 (33 / 174) |
| LLM fallback cache-write input tokens (reported calls / all calls) | 62403 (33 / 96) |
| LLM complete cache-write input tokens (reported calls / all calls) | n/a (0 / 78) |
| LLM provider-reported cost (reported calls / all calls) | n/a (0 / 174) |
| LLM fallback provider-reported cost (reported calls / all calls) | n/a (0 / 96) |
| LLM complete provider-reported cost (reported calls / all calls) | n/a (0 / 78) |

## all

| Metric | jev-poc |
| --- | --- |
| Runs | 465 |
| Secondary judge (unvalidated) | Judge: 0 scored, 0 failed, 465 not run. disabled: 465. |
| Overall pass | 319/408 (78.2%) |
| Arrangement pass | 172/183 (94.0%) |
| Errors | 0 |
| Decisive turns pass | 179/245 (73.1%) |
| Decisive wins / losses vs baseline (paired) | 0 / 0 (0) |
| Expected deferrals at the right stage | 45/57 (78.9%) |
| Fallback rate | 219/465 (47.1%) |
| Fallbacks: jevActions/action_limit | 14 |
| Fallbacks: jevActions/action_unsupported | 136 |
| Fallbacks: jevLayout/layout_unavailable | 8 |
| Fallbacks: jevLayout/no_feasible_layout | 6 |
| Fallbacks: jevSelect/scope_ambiguous | 18 |
| Fallbacks: jevSelect/scope_unsupported | 37 |
| Selection accuracy | 336/386 (87.0%) |
| Actions accuracy | 233/253 (92.1%) |
| Layout accuracy | 198/245 (80.8%) |
| llmComplete fill rate | 15/15 (100.0%) |
| needsActions gate false positives / negatives | n/a |
| Spatial gate false positives / negatives | n/a (162 spatial, 36 controls) |
| Arrangement turns reaching jevLayout | 54/183 (29.5%) |
| Replayed stages | none |
| Turn latency p50 / p95 (ms) | 2777 / 4793 |
| jevSelect latency p50 / p95 (ms) | 209 / 262 |
| jevActions latency p50 / p95 (ms) | 293 / 1176 |
| jevLayout latency p50 / p95 (ms) | 172 / 220 |
| llmComplete latency p50 / p95 (ms) | 1271 / 2162 |
| Stage call latency p50 / p95 (ms) | 184 / 241 |
| LLM fallback call latency p50 / p95 (ms) | 3009 / 5338 |
| LLM complete call latency p50 / p95 (ms) | 1268 / 2161 |
| Stage calls / input / output tokens | 1659 / 5218352 / 602040 |
| Stage calls per turn | 3.57 |
| Stage tokens per turn (input / output) | 11222.3 / 1294.7 |
| LLM calls / input / output tokens | 465 / 1269969 / 74001 |
| LLM fallback calls / input / output tokens | 219 / 1205647 / 64580 |
| LLM complete calls / input / output tokens | 246 / 64322 / 9421 |
| LLM cache-read input tokens (reported calls / all calls) | 1060146 (218 / 465) |
| LLM fallback cache-read input tokens (reported calls / all calls) | 1060146 (218 / 219) |
| LLM complete cache-read input tokens (reported calls / all calls) | n/a (0 / 246) |
| LLM cache-write input tokens (reported calls / all calls) | 144844 (75 / 465) |
| LLM fallback cache-write input tokens (reported calls / all calls) | 144844 (75 / 219) |
| LLM complete cache-write input tokens (reported calls / all calls) | n/a (0 / 246) |
| LLM provider-reported cost (reported calls / all calls) | n/a (0 / 465) |
| LLM fallback provider-reported cost (reported calls / all calls) | n/a (0 / 219) |
| LLM complete provider-reported cost (reported calls / all calls) | n/a (0 / 246) |
