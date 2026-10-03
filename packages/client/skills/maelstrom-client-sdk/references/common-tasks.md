# Construct the framework-independent client

Supply an application-configured Connector and developer-authored definitions.
Keep React rendering in the React package.

```ts
import { type EngineConnector, Orchestrator } from '@maelstrom-co/client';
import type { VesselDefinition } from '@maelstrom-co/protocol';

export function createClient(
  connector: EngineConnector,
  vessels: readonly VesselDefinition[],
) {
  return new Orchestrator(connector, { vessels, layoutMode: 'tiling' });
}
```

Connect and disconnect through the installed lifecycle API. Keep the same
application session identity across transport re-authentication when required.
Use client-owned Chart dimensions and the normal resize/update request path.

## Verify

Use a deterministic Connector at the transport boundary. Observe connection,
request, and command-processing errors. Check the resulting Instances and Actions,
not just whether `processIntent()` resolved. An Engine response must apply layout
before Actions targeting Instances introduced by that response.

## Troubleshoot

- A first-screen seed requires tiling mode and statically registered definitions.
- Conflicts during updates require an application policy; keep previous state
  rather than dropping incompatible Instances silently.
- Inspect the published declaration entrypoint for signatures and the runtime
  bundle for implementation. Declaration subpaths are not runtime file promises.
- A local Connector test is not evidence of a live Engine or provider connection.
