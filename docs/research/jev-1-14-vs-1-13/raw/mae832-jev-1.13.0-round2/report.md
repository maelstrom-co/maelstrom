# planner eval

- suite: all
- arms: jev-poc
- repeats: 3
- scenarios: 155
- llmModel: gpt-5.6-luna
- jevModel: jev-1.13.0
- date: 2026-11-08T10:58:43.818Z

## development

| Metric | jev-poc |
| --- | --- |
| Runs | 291 |
| Secondary judge (unvalidated) | Judge: 0 scored, 0 failed, 291 not run. disabled: 291. |
| Overall pass | 196/258 (76.0%) |
| Arrangement pass | 90/96 (93.8%) |
| Errors | 0 |
| Decisive turns pass | 123/170 (72.4%) |
| Decisive wins / losses vs baseline (paired) | 0 / 0 (0) |
| Expected deferrals at the right stage | 24/33 (72.7%) |
| Fallback rate | 121/291 (41.6%) |
| Fallbacks: jevActions/action_limit | 12 |
| Fallbacks: jevActions/action_unsupported | 66 |
| Fallbacks: jevLayout/layout_unavailable | 3 |
| Fallbacks: jevLayout/no_feasible_layout | 6 |
| Fallbacks: jevSelect/scope_ambiguous | 12 |
| Fallbacks: jevSelect/scope_unsupported | 22 |
| Selection accuracy | 202/239 (84.5%) |
| Actions accuracy | 158/173 (91.3%) |
| Layout accuracy | 136/170 (80.0%) |
| llmComplete fill rate | 12/12 (100.0%) |
| needsActions gate false positives / negatives | n/a |
| Spatial gate false positives / negatives | n/a (84 spatial, 24 controls) |
| Arrangement turns reaching jevLayout | 35/96 (36.5%) |
| Replayed stages | none |
| Turn latency p50 / p95 (ms) | 2568 / 4339 |
| jevSelect latency p50 / p95 (ms) | 212 / 265 |
| jevActions latency p50 / p95 (ms) | 389 / 1487 |
| jevLayout latency p50 / p95 (ms) | 172 / 241 |
| llmComplete latency p50 / p95 (ms) | 1240 / 2015 |
| Stage call latency p50 / p95 (ms) | 183 / 251 |
| LLM fallback call latency p50 / p95 (ms) | 2633 / 4355 |
| LLM complete call latency p50 / p95 (ms) | 1235 / 2008 |
| Stage calls / input / output tokens | 1100 / 3367693 / 399776 |
| Stage calls per turn | 3.78 |
| Stage tokens per turn (input / output) | 11572.8 / 1373.8 |
| LLM calls / input / output tokens | 291 / 710055 / 40535 |
| LLM fallback calls / input / output tokens | 121 / 665203 / 34196 |
| LLM complete calls / input / output tokens | 170 / 44852 / 6339 |
| LLM cache-read input tokens (reported calls / all calls) | 662940 (121 / 291) |
| LLM fallback cache-read input tokens (reported calls / all calls) | 662940 (121 / 121) |
| LLM complete cache-read input tokens (reported calls / all calls) | n/a (0 / 170) |
| LLM cache-write input tokens (reported calls / all calls) | 1900 (1 / 291) |
| LLM fallback cache-write input tokens (reported calls / all calls) | 1900 (1 / 121) |
| LLM complete cache-write input tokens (reported calls / all calls) | n/a (0 / 170) |
| LLM provider-reported cost (reported calls / all calls) | n/a (0 / 291) |
| LLM fallback provider-reported cost (reported calls / all calls) | n/a (0 / 121) |
| LLM complete provider-reported cost (reported calls / all calls) | n/a (0 / 170) |

## holdout

| Metric | jev-poc |
| --- | --- |
| Runs | 174 |
| Secondary judge (unvalidated) | Judge: 0 scored, 0 failed, 174 not run. disabled: 174. |
| Overall pass | 125/150 (83.3%) |
| Arrangement pass | 82/87 (94.3%) |
| Errors | 0 |
| Decisive turns pass | 56/76 (73.7%) |
| Decisive wins / losses vs baseline (paired) | 0 / 0 (0) |
| Expected deferrals at the right stage | 21/24 (87.5%) |
| Fallback rate | 98/174 (56.3%) |
| Fallbacks: jevActions/action_limit | 3 |
| Fallbacks: jevActions/action_unsupported | 71 |
| Fallbacks: jevLayout/layout_unavailable | 4 |
| Fallbacks: jevSelect/scope_ambiguous | 6 |
| Fallbacks: jevSelect/scope_unsupported | 14 |
| Selection accuracy | 133/148 (89.9%) |
| Actions accuracy | 74/80 (92.5%) |
| Layout accuracy | 62/76 (81.6%) |
| llmComplete fill rate | 3/3 (100.0%) |
| needsActions gate false positives / negatives | n/a |
| Spatial gate false positives / negatives | n/a (78 spatial, 12 controls) |
| Arrangement turns reaching jevLayout | 19/87 (21.8%) |
| Replayed stages | none |
| Turn latency p50 / p95 (ms) | 2761 / 3979 |
| jevSelect latency p50 / p95 (ms) | 210 / 268 |
| jevActions latency p50 / p95 (ms) | 194 / 856 |
| jevLayout latency p50 / p95 (ms) | 168 / 216 |
| llmComplete latency p50 / p95 (ms) | 1212 / 1729 |
| Stage call latency p50 / p95 (ms) | 181 / 241 |
| LLM fallback call latency p50 / p95 (ms) | 2744 / 4877 |
| LLM complete call latency p50 / p95 (ms) | 1211 / 1724 |
| Stage calls / input / output tokens | 565 / 1860821 / 204782 |
| Stage calls per turn | 3.25 |
| Stage tokens per turn (input / output) | 10694.4 / 1176.9 |
| LLM calls / input / output tokens | 174 / 559759 / 31306 |
| LLM fallback calls / input / output tokens | 98 / 540394 / 28693 |
| LLM complete calls / input / output tokens | 76 / 19365 / 2613 |
| LLM cache-read input tokens (reported calls / all calls) | 538183 (98 / 174) |
| LLM fallback cache-read input tokens (reported calls / all calls) | 538183 (98 / 98) |
| LLM complete cache-read input tokens (reported calls / all calls) | n/a (0 / 76) |
| LLM cache-write input tokens (reported calls / all calls) | 1917 (1 / 174) |
| LLM fallback cache-write input tokens (reported calls / all calls) | 1917 (1 / 98) |
| LLM complete cache-write input tokens (reported calls / all calls) | n/a (0 / 76) |
| LLM provider-reported cost (reported calls / all calls) | n/a (0 / 174) |
| LLM fallback provider-reported cost (reported calls / all calls) | n/a (0 / 98) |
| LLM complete provider-reported cost (reported calls / all calls) | n/a (0 / 76) |

## all

| Metric | jev-poc |
| --- | --- |
| Runs | 465 |
| Secondary judge (unvalidated) | Judge: 0 scored, 0 failed, 465 not run. disabled: 465. |
| Overall pass | 321/408 (78.7%) |
| Arrangement pass | 172/183 (94.0%) |
| Errors | 0 |
| Decisive turns pass | 179/246 (72.8%) |
| Decisive wins / losses vs baseline (paired) | 0 / 0 (0) |
| Expected deferrals at the right stage | 45/57 (78.9%) |
| Fallback rate | 219/465 (47.1%) |
| Fallbacks: jevActions/action_limit | 15 |
| Fallbacks: jevActions/action_unsupported | 137 |
| Fallbacks: jevLayout/layout_unavailable | 7 |
| Fallbacks: jevLayout/no_feasible_layout | 6 |
| Fallbacks: jevSelect/scope_ambiguous | 18 |
| Fallbacks: jevSelect/scope_unsupported | 36 |
| Selection accuracy | 335/387 (86.6%) |
| Actions accuracy | 232/253 (91.7%) |
| Layout accuracy | 198/246 (80.5%) |
| llmComplete fill rate | 15/15 (100.0%) |
| needsActions gate false positives / negatives | n/a |
| Spatial gate false positives / negatives | n/a (162 spatial, 36 controls) |
| Arrangement turns reaching jevLayout | 54/183 (29.5%) |
| Replayed stages | none |
| Turn latency p50 / p95 (ms) | 2610 / 4176 |
| jevSelect latency p50 / p95 (ms) | 211 / 266 |
| jevActions latency p50 / p95 (ms) | 282 / 1181 |
| jevLayout latency p50 / p95 (ms) | 170 / 241 |
| llmComplete latency p50 / p95 (ms) | 1232 / 1966 |
| Stage call latency p50 / p95 (ms) | 183 / 250 |
| LLM fallback call latency p50 / p95 (ms) | 2672 / 4538 |
| LLM complete call latency p50 / p95 (ms) | 1228 / 1962 |
| Stage calls / input / output tokens | 1665 / 5228514 / 604558 |
| Stage calls per turn | 3.58 |
| Stage tokens per turn (input / output) | 11244.1 / 1300.1 |
| LLM calls / input / output tokens | 465 / 1269814 / 71841 |
| LLM fallback calls / input / output tokens | 219 / 1205597 / 62889 |
| LLM complete calls / input / output tokens | 246 / 64217 / 8952 |
| LLM cache-read input tokens (reported calls / all calls) | 1201123 (219 / 465) |
| LLM fallback cache-read input tokens (reported calls / all calls) | 1201123 (219 / 219) |
| LLM complete cache-read input tokens (reported calls / all calls) | n/a (0 / 246) |
| LLM cache-write input tokens (reported calls / all calls) | 3817 (2 / 465) |
| LLM fallback cache-write input tokens (reported calls / all calls) | 3817 (2 / 219) |
| LLM complete cache-write input tokens (reported calls / all calls) | n/a (0 / 246) |
| LLM provider-reported cost (reported calls / all calls) | n/a (0 / 465) |
| LLM fallback provider-reported cost (reported calls / all calls) | n/a (0 / 219) |
| LLM complete provider-reported cost (reported calls / all calls) | n/a (0 / 246) |
