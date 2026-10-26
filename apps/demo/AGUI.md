# AG-UI in the demo

Select **Workspace → AG-UI** to use the experimental adapter with the normal demo's typed input, Chart, Vessels, and native voice. The [demo README](./README.md) covers startup and key entry. The protocol package owns the [wire contract](../../packages/agui-protocol/CONTRACT.md), including private ingress, correlation, settlement, and recovery limits.

## Application and host wiring

The demo supplies authentication, Engine configuration, host dispatch, and socket checkpoint storage. The hosted Worker routes `/ws` to the session's Durable Object. Both protocol selections use the same origin checks, connection rate limiter, browser-owned key handshake, heartbeat, and Engine factory. Local development uses the existing Bun WebSocket host.

The protocol selector creates a fresh workspace session and disconnects voice. Application data remains in the tab's memory. React displays protocol errors with application-specific recovery instructions. Application acknowledgment runs through the client lifecycle and requires no React observer.

Both selections allow five seconds for a lazy Vessel's Action runner to register. Cold module loading can exceed the client's default 500 ms. Readiness expiry skips the Action; it never triggers a write retry.

## Native voice

Voice audio uses its provider's native connection. A voice `update_ui` call enters the same Orchestrator as typed input and uses the selected workspace protocol. Grounding, captions, provider switching, and speech playback remain in the voice integration.

Engine history reads and acknowledged message insertion use native control frames on the same WebSocket. AG-UI run completion does not acknowledge a spoken greeting or prove audio playback.

## Hosted idle recovery

The Durable Object stores the adapter's non-content checkpoint in the socket attachment. After hibernation, `playground.rehello` restores the browser-owned key while the checkpoint preserves the acknowledgment gate. The attachment contains no key or application content.

Attachments last only as long as the socket. Engine history remains memory-only. Socket loss during planning or acknowledgment stops continuation without replay. Inspect the workspace before starting a new session through the selector or page reload; a new session does not reconcile an uncertain write.

## Verification

Demo tests cover BYOK, native history acknowledgment, typed and voice FIFO admission, Worker reconstruction, and protocol switching. Browser tests use the hosted bundle with a fixture Planner, including delayed Journal loading.

Live voice and actual Cloudflare hibernation require a deployed preview and a browser-owned key. A reconstructed local object or an idle round trip without observed rehello does not establish platform hibernation.

The [separate Journal proof](./EXPERIMENTAL-AGUI.md) demonstrates a bounded result-dependent loop. It is independent of the normal demo's workspace protocol selector.
