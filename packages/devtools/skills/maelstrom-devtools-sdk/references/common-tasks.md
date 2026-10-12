# Mount a framework-independent inspector

Supply the application's existing Orchestrator. Mount in a browser and release
the panel and client observation when the surface is removed.

```ts
import type { Orchestrator } from '@maelstrom-co/client';
import { createDevtools, mountDevtools } from '@maelstrom-co/devtools';

export function inspectClient(orchestrator: Orchestrator) {
  const tools = createDevtools({ maxActivityEvents: 200 });
  const detach = tools.attach(orchestrator);
  const unmount = mountDevtools(tools);
  return () => {
    unmount();
    detach();
    tools.dispose();
  };
}
```

## Verify

Observe a request ID through receipt, layout application, and Action outcomes.
Check skipped Actions and discarded responses separately from successful work.
Use Requests for grouped outcomes and All events for uncorrelated observations.
Use Inspector for layout and capability evidence. Start content capture through
Recordings with an explicit scope, stop it, export it, and reopen the file.
Confirm the imported capture does not execute client work. Test that application
redaction removes sensitive values before they enter retained evidence.
The UI calls captures recordings; the Capture API and file schema keep their names.

## Troubleshoot

- Empty metadata: attach before connecting, and check that tools are enabled.
- Missing server traces: the host must enable and bind its diagnostic connection.
- Missing token usage: the planner may not report it; preserve that as unknown.
- Retained client: detachment preserves evidence until Clear or reload.
- Missing production UI: the default entrypoint is inert; use `@maelstrom-co/devtools/production` for deliberate opt-in.
