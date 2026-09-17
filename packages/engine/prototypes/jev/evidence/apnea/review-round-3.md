---
status: done
verdict: APPROVED
---

No blocking findings.

Both round-2 findings are resolved:

- Retry ownership is explicit. Adapter `maxRetries` is compatibility sugar for engine-owned `maxRepairAttempts`. Explicit routes own repair limits. `createLlmPlanner` accepts no retry count and makes one claimed `chat()` call per invocation.
- Call accounting now means planner-visible logical invocations. Started claims are never refunded. Hidden adapter HTTP retries are explicitly outside that count. Budget exhaustion and malformed responses have distinct public error tags and wire codes.

The defaults are consistent. Adapter shorthand retains `maxRetries: 1`, derives two logical calls, uses heal-and-ship, disables the engine deadline, and has no fallback. Explicit routes require finalization, repair, timeout, and logical-call policies.

The finite examples use a 25-second engine deadline. The demo connector uses `WebSocketConnector`'s actual 30-second default request timeout, leaving five seconds for error mapping, serialization, and delivery. The plan also requires hosts to keep engine deadlines below their shortest transport or platform timeout.
