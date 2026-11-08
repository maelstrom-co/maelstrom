# planner eval

- suite: all
- arms: jev-poc
- repeats: 3
- scenarios: 155
- llmModel: gpt-5.6-luna
- jevModel: jev-1.14.0
- date: 2026-11-08T10:36:20.107Z

## development

| Metric | jev-poc |
| --- | --- |
| Runs | 291 |
| Secondary judge (unvalidated) | Judge: 0 scored, 0 failed, 291 not run. disabled: 291. |
| Overall pass | 192/258 (74.4%) |
| Arrangement pass | 90/96 (93.8%) |
| Errors | 0 |
| Decisive turns pass | 121/168 (72.0%) |
| Decisive wins / losses vs baseline (paired) | 0 / 0 (0) |
| Expected deferrals at the right stage | 21/33 (63.6%) |
| Fallback rate | 119/291 (40.9%) |
| Fallbacks: jevActions/action_limit | 12 |
| Fallbacks: jevActions/action_unsupported | 65 |
| Fallbacks: jevLayout/layout_unavailable | 5 |
| Fallbacks: jevLayout/no_feasible_layout | 6 |
| Fallbacks: jevSelect/scope_ambiguous | 10 |
| Fallbacks: jevSelect/scope_unsupported | 21 |
| Selection accuracy | 199/237 (84.0%) |
| Actions accuracy | 156/173 (90.2%) |
| Layout accuracy | 131/166 (78.9%) |
| llmComplete fill rate | 12/12 (100.0%) |
| needsActions gate false positives / negatives | n/a |
| Spatial gate false positives / negatives | n/a (84 spatial, 24 controls) |
| Arrangement turns reaching jevLayout | 34/96 (35.4%) |
| Replayed stages | none |
| Turn latency p50 / p95 (ms) | 2573 / 4428 |
| jevSelect latency p50 / p95 (ms) | 208 / 244 |
| jevActions latency p50 / p95 (ms) | 468 / 1538 |
| jevLayout latency p50 / p95 (ms) | 169 / 206 |
| llmComplete latency p50 / p95 (ms) | 1253 / 1966 |
| Stage call latency p50 / p95 (ms) | 179 / 228 |
| LLM fallback call latency p50 / p95 (ms) | 2741 / 4224 |
| LLM complete call latency p50 / p95 (ms) | 1251 / 1965 |
| Stage calls / input / output tokens | 1133 / 3412737 / 407792 |
| Stage calls per turn | 3.89 |
| Stage tokens per turn (input / output) | 11727.6 / 1401.3 |
| LLM calls / input / output tokens | 291 / 698876 / 39456 |
| LLM fallback calls / input / output tokens | 119 / 653160 / 33111 |
| LLM complete calls / input / output tokens | 172 / 45716 / 6345 |
| LLM cache-read input tokens (reported calls / all calls) | 570904 (118 / 291) |
| LLM fallback cache-read input tokens (reported calls / all calls) | 570904 (118 / 119) |
| LLM complete cache-read input tokens (reported calls / all calls) | n/a (0 / 172) |
| LLM cache-write input tokens (reported calls / all calls) | 81899 (42 / 291) |
| LLM fallback cache-write input tokens (reported calls / all calls) | 81899 (42 / 119) |
| LLM complete cache-write input tokens (reported calls / all calls) | n/a (0 / 172) |
| LLM provider-reported cost (reported calls / all calls) | n/a (0 / 291) |
| LLM fallback provider-reported cost (reported calls / all calls) | n/a (0 / 119) |
| LLM complete provider-reported cost (reported calls / all calls) | n/a (0 / 172) |

## holdout

| Metric | jev-poc |
| --- | --- |
| Runs | 174 |
| Secondary judge (unvalidated) | Judge: 0 scored, 0 failed, 174 not run. disabled: 174. |
| Overall pass | 117/150 (78.0%) |
| Arrangement pass | 80/87 (92.0%) |
| Errors | 0 |
| Decisive turns pass | 48/71 (67.6%) |
| Decisive wins / losses vs baseline (paired) | 0 / 0 (0) |
| Expected deferrals at the right stage | 20/24 (83.3%) |
| Fallback rate | 100/174 (57.5%) |
| Fallbacks: jevActions/action_limit | 2 |
| Fallbacks: jevActions/action_unsupported | 75 |
| Fallbacks: jevLayout/layout_unavailable | 3 |
| Fallbacks: jevSelect/scope_ambiguous | 6 |
| Fallbacks: jevSelect/scope_unsupported | 12 |
| Fallbacks: llmComplete/retry_recommended | 2 |
| Selection accuracy | 129/150 (86.0%) |
| Actions accuracy | 71/76 (93.4%) |
| Layout accuracy | 53/73 (72.6%) |
| llmComplete fill rate | 3/3 (100.0%) |
| needsActions gate false positives / negatives | n/a |
| Spatial gate false positives / negatives | n/a (78 spatial, 12 controls) |
| Arrangement turns reaching jevLayout | 18/87 (20.7%) |
| Replayed stages | none |
| Turn latency p50 / p95 (ms) | 2838 / 4460 |
| jevSelect latency p50 / p95 (ms) | 209 / 246 |
| jevActions latency p50 / p95 (ms) | 190 / 919 |
| jevLayout latency p50 / p95 (ms) | 171 / 214 |
| llmComplete latency p50 / p95 (ms) | 1271 / 1854 |
| Stage call latency p50 / p95 (ms) | 182 / 231 |
| LLM fallback call latency p50 / p95 (ms) | 2817 / 4586 |
| LLM complete call latency p50 / p95 (ms) | 1270 / 1849 |
| Stage calls / input / output tokens | 562 / 1855926 / 203521 |
| Stage calls per turn | 3.23 |
| Stage tokens per turn (input / output) | 10666.2 / 1169.7 |
| LLM calls / input / output tokens | 176 / 569833 / 31364 |
| LLM fallback calls / input / output tokens | 100 / 550255 / 28551 |
| LLM complete calls / input / output tokens | 76 / 19578 / 2813 |
| LLM cache-read input tokens (reported calls / all calls) | 484321 (100 / 176) |
| LLM fallback cache-read input tokens (reported calls / all calls) | 484321 (100 / 100) |
| LLM complete cache-read input tokens (reported calls / all calls) | n/a (0 / 76) |
| LLM cache-write input tokens (reported calls / all calls) | 65634 (35 / 176) |
| LLM fallback cache-write input tokens (reported calls / all calls) | 65634 (35 / 100) |
| LLM complete cache-write input tokens (reported calls / all calls) | n/a (0 / 76) |
| LLM provider-reported cost (reported calls / all calls) | n/a (0 / 176) |
| LLM fallback provider-reported cost (reported calls / all calls) | n/a (0 / 100) |
| LLM complete provider-reported cost (reported calls / all calls) | n/a (0 / 76) |

## all

| Metric | jev-poc |
| --- | --- |
| Runs | 465 |
| Secondary judge (unvalidated) | Judge: 0 scored, 0 failed, 465 not run. disabled: 465. |
| Overall pass | 309/408 (75.7%) |
| Arrangement pass | 170/183 (92.9%) |
| Errors | 0 |
| Decisive turns pass | 169/239 (70.7%) |
| Decisive wins / losses vs baseline (paired) | 0 / 0 (0) |
| Expected deferrals at the right stage | 41/57 (71.9%) |
| Fallback rate | 219/465 (47.1%) |
| Fallbacks: jevActions/action_limit | 14 |
| Fallbacks: jevActions/action_unsupported | 140 |
| Fallbacks: jevLayout/layout_unavailable | 8 |
| Fallbacks: jevLayout/no_feasible_layout | 6 |
| Fallbacks: jevSelect/scope_ambiguous | 16 |
| Fallbacks: jevSelect/scope_unsupported | 33 |
| Fallbacks: llmComplete/retry_recommended | 2 |
| Selection accuracy | 328/387 (84.8%) |
| Actions accuracy | 227/249 (91.2%) |
| Layout accuracy | 184/239 (77.0%) |
| llmComplete fill rate | 15/15 (100.0%) |
| needsActions gate false positives / negatives | n/a |
| Spatial gate false positives / negatives | n/a (162 spatial, 36 controls) |
| Arrangement turns reaching jevLayout | 52/183 (28.4%) |
| Replayed stages | none |
| Turn latency p50 / p95 (ms) | 2679 / 4428 |
| jevSelect latency p50 / p95 (ms) | 208 / 245 |
| jevActions latency p50 / p95 (ms) | 314 / 1240 |
| jevLayout latency p50 / p95 (ms) | 169 / 206 |
| llmComplete latency p50 / p95 (ms) | 1262 / 1923 |
| Stage call latency p50 / p95 (ms) | 180 / 229 |
| LLM fallback call latency p50 / p95 (ms) | 2795 / 4317 |
| LLM complete call latency p50 / p95 (ms) | 1259 / 1917 |
| Stage calls / input / output tokens | 1695 / 5268663 / 611313 |
| Stage calls per turn | 3.65 |
| Stage tokens per turn (input / output) | 11330.5 / 1314.7 |
| LLM calls / input / output tokens | 467 / 1268709 / 70820 |
| LLM fallback calls / input / output tokens | 219 / 1203415 / 61662 |
| LLM complete calls / input / output tokens | 248 / 65294 / 9158 |
| LLM cache-read input tokens (reported calls / all calls) | 1055225 (218 / 467) |
| LLM fallback cache-read input tokens (reported calls / all calls) | 1055225 (218 / 219) |
| LLM complete cache-read input tokens (reported calls / all calls) | n/a (0 / 248) |
| LLM cache-write input tokens (reported calls / all calls) | 147533 (77 / 467) |
| LLM fallback cache-write input tokens (reported calls / all calls) | 147533 (77 / 219) |
| LLM complete cache-write input tokens (reported calls / all calls) | n/a (0 / 248) |
| LLM provider-reported cost (reported calls / all calls) | n/a (0 / 467) |
| LLM fallback provider-reported cost (reported calls / all calls) | n/a (0 / 219) |
| LLM complete provider-reported cost (reported calls / all calls) | n/a (0 / 248) |
