/**
 * Interactive agent conversation driven through the client SDK: an
 * `Orchestrator` over a `WebSocketConnector`, seeded with the pet shop
 * vessels and starting screen. Every plain line is sent as an utterance, and
 * agent events, applied changes, and Action outcomes print as they arrive.
 *
 * Start the local engine server with a server-held `OPENAI_API_KEY`
 * (`cd apps/demo && bun run dev:ws`), then run from the workspace root:
 *
 *   bun --conditions=@maelstrom-co/source apps/demo/scripts/agent-repl.ts
 *
 * or `bun run agent-repl` from `apps/demo`. The source condition resolves
 * `@maelstrom-co/client` to workspace source instead of a possibly stale
 * build.
 *
 * By default the server runs the pet shop agent, which answers with Server
 * Tools and text and sends no `ui_change`. Start the server with
 * `MAELSTROM_AGENT=off` to get the UI-only route, where each utterance is
 * planned into a `ui_change` the Orchestrator applies and acknowledges.
 *
 * Options:
 *   --stale <ms|off>  initial `agentRunStaleTimeoutMs` (default: the client
 *                     default, `off` disables the stale run safety net)
 *   --real-actions    register no fake Action runners, so Actions skip
 *   --help            print this usage and exit
 *
 * `DEMO_WS_URL` overrides the socket URL (default `ws://localhost:3001/ws`).
 *
 * Commands:
 *   /help              list commands
 *   /connect           connect the Orchestrator
 *   /disconnect        disconnect the Orchestrator
 *   /swap              replace the connector with a fresh one and connect
 *   /stale <ms|off>    rebuild the Orchestrator with a new stale timeout
 *   /chart             print the board
 *   /exit, /quit       dispose and exit (Ctrl-D and Ctrl-C do the same)
 *
 * The real Action runners live in the React vessel components, so by
 * default every Instance on the board gets a fake runner that logs the
 * Action and its params and reports success. That lets a run finish with
 * its reply. With `--real-actions` no runners are registered, Actions skip
 * after the readiness wait, and the Engine fails the run.
 */
import { createInterface } from 'node:readline';

import {
  type BatchExecutionResult,
  Orchestrator,
  WebSocketConnector,
} from '@maelstrom-co/client';
import {
  type AgentEvent,
  type AgentInput,
  type InstanceId,
  ok,
} from '@maelstrom-co/protocol';

import { SHOP_LAYOUT } from '../src/shop/default-layout';
import { cartVessel } from '../src/shop/vessels/cart.vessel.def';
import { catalogVessel } from '../src/shop/vessels/catalog.vessel.def';
import { checkoutVessel } from '../src/shop/vessels/checkout.vessel.def';
import { ordersVessel } from '../src/shop/vessels/orders.vessel.def';

const DEFAULT_WS_URL = 'ws://localhost:3001/ws';
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const STALE_VALUE_HINT = `ms between 1 and ${MAX_TIMER_DELAY_MS}, or off`;
const SHOP_VESSELS = [ordersVessel, catalogVessel, cartVessel, checkoutVessel];
const COMMAND_HELP =
  'Commands: /help /connect /disconnect /swap /stale <ms|off> /chart /exit. Any other line is sent as an utterance.';
const USAGE = `Usage: bun --conditions=@maelstrom-co/source apps/demo/scripts/agent-repl.ts [--stale <ms|off>] [--real-actions] [--help]

DEMO_WS_URL overrides the socket URL (default ${DEFAULT_WS_URL}).
${COMMAND_HELP}`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const url = process.env.DEMO_WS_URL?.trim() || DEFAULT_WS_URL;
const startedAt = performance.now();
let staleTimeoutMs = readInitialStaleTimeout(args);
const fakeActions = !args.includes('--real-actions');
let orchestrator = buildOrchestrator(staleTimeoutMs);
let quitting = false;
let exitRequested = false;
let inputClosed = false;

log(
  'session',
  `${url} sessionId=${orchestrator.getConfig().sessionId} actions=${fakeActions ? 'fake' : 'real'}`,
);
log('help', COMMAND_HELP);
await connectOrchestrator();

const input = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});
let pendingLines = Promise.resolve();
input.on('line', (line) => {
  pendingLines = pendingLines.then(() => handleLine(line.trim()));
});
input.on('close', () => {
  inputClosed = true;
  pendingLines = pendingLines.then(quit);
});
input.on('SIGINT', requestExit);
process.on('SIGINT', requestExit);
input.prompt();

async function handleLine(line: string): Promise<void> {
  if (quitting || exitRequested) return;
  try {
    if (line === '') return;
    if (!line.startsWith('/')) {
      const inputId = await orchestrator.sendMessage(line);
      log('sent', `inputId=${inputId}`);
      return;
    }
    const [command, ...rest] = line.split(/\s+/);
    switch (command) {
      case '/help':
        log('help', COMMAND_HELP);
        return;
      case '/connect':
        await connectOrchestrator();
        return;
      case '/disconnect':
        await orchestrator.disconnect();
        log('disconnect', 'done');
        return;
      case '/swap':
        orchestrator.setConnector(createLoggingConnector());
        log('swap', 'connector replaced');
        await connectOrchestrator();
        return;
      case '/stale':
        await rebuildWithStaleTimeout(rest[0]);
        return;
      case '/chart':
        printBoard('chart');
        return;
      case '/exit':
      case '/quit':
        requestExit();
        return;
      default:
        log('repl error', `unknown command ${command}. ${COMMAND_HELP}`);
    }
  } catch (error) {
    log('repl error', describeError(error));
  } finally {
    if (!inputClosed) input.prompt();
  }
}

function requestExit(): void {
  exitRequested = true;
  input.close();
}

async function quit(): Promise<void> {
  if (quitting) return;
  quitting = true;
  await orchestrator.dispose();
  log('quit', 'disposed');
  process.exit(0);
}

async function rebuildWithStaleTimeout(value: string | undefined) {
  const parsed = parseStaleTimeout(value);
  if (parsed === undefined) {
    log('repl error', `/stale needs ${STALE_VALUE_HINT}, got ${value}`);
    return;
  }
  await orchestrator.dispose();
  staleTimeoutMs = parsed;
  orchestrator = buildOrchestrator(staleTimeoutMs);
  log(
    'stale',
    `rebuilt with agentRunStaleTimeoutMs=${staleTimeoutMs ?? 'default'} sessionId=${orchestrator.getConfig().sessionId}`,
  );
  await connectOrchestrator();
}

async function connectOrchestrator(): Promise<void> {
  try {
    await orchestrator.connect();
  } catch (error) {
    log('repl error', `connect failed: ${describeError(error)}`);
  }
}

function buildOrchestrator(agentRunStaleTimeoutMs: number | undefined) {
  const next = new Orchestrator(createLoggingConnector(), {
    vessels: SHOP_VESSELS,
    initialLayout: SHOP_LAYOUT,
    ...(agentRunStaleTimeoutMs === undefined ? {} : { agentRunStaleTimeoutMs }),
  });
  next.agent.on('placeholder', (event) =>
    log(
      'placeholder',
      `inputId=${event.inputId} ${JSON.stringify(event.text)}`,
    ),
  );
  next.agent.on('message', (event) =>
    log('message', `runId=${event.runId} ${JSON.stringify(event.delta)}`),
  );
  next.agent.on('finished', (event) =>
    log(
      'finished',
      `runId=${event.runId} ok=${event.ok} reason=${event.reason}${event.code ? ` code=${event.code}` : ''}${event.error ? ` error=${JSON.stringify(event.error)}` : ''} reply=${JSON.stringify(event.reply)}`,
    ),
  );
  next.agent.on('error', (event) =>
    log(
      'error',
      `${event.inputId ? `inputId=${event.inputId} ` : ''}${event.code ? `code=${event.code} ` : ''}${JSON.stringify(event.error)}`,
    ),
  );
  next.agent.on('conversation_lost', (event) =>
    log(
      'conversation_lost',
      `reason=${event.reason}${event.runId ? ` runId=${event.runId}` : ''}${event.inputId ? ` inputId=${event.inputId}` : ''}`,
    ),
  );
  if (fakeActions) registerFakeRunners(next);
  next.commandProcessor.events.on('actions_completed', (event) =>
    printActionOutcomes(event.result),
  );
  next.onSettled(() => printBoard('applied'));
  let lastStatus = next.connectionManager.store.state.connectionStatus;
  next.connectionManager.store.subscribe(() => {
    const status = next.connectionManager.store.state.connectionStatus;
    if (status === lastStatus) return;
    lastStatus = status;
    log('connection', status);
  });
  return next;
}

function registerFakeRunners(target: Orchestrator): void {
  const releases = new Map<InstanceId, () => void>();
  const sync = () => {
    const { instances } = target.commandProcessor.store.state;
    for (const instanceId of instances.keys()) {
      if (releases.has(instanceId)) continue;
      releases.set(
        instanceId,
        target.commandProcessor.registerRunner(
          instanceId,
          createFakeRunner(instanceId),
        ),
      );
    }
    for (const [instanceId, release] of releases) {
      if (instances.has(instanceId)) continue;
      release();
      releases.delete(instanceId);
    }
  };
  sync();
  target.commandProcessor.store.subscribe(sync);
}

function createFakeRunner(instanceId: InstanceId) {
  return new Proxy(
    {},
    {
      get: (_target, action) =>
        typeof action !== 'string' || action === 'then'
          ? undefined
          : async (params?: unknown) => {
              log(
                'fake action',
                `${instanceId}.${action}${params === undefined ? '' : ` ${JSON.stringify(params)}`}`,
              );
              return ok(undefined);
            },
    },
  );
}

function printBoard(label: string): void {
  const { instances, layout } = orchestrator.commandProcessor.store.state;
  if (instances.size === 0) {
    log(label, 'board is empty');
    return;
  }
  const tiles = [...instances.values()].map(
    (instance) =>
      `${instance.instanceId} (${instance.vesselId}:${instance.variant})`,
  );
  const tree =
    layout?.type === 'tiling' ? ` tree=${JSON.stringify(layout.tree)}` : '';
  log(label, `${tiles.join(', ')}${tree}`);
}

function printActionOutcomes(result: BatchExecutionResult): void {
  for (const record of result.actions) {
    const outcome = record.skipped
      ? `skipped${record.errorCategory ? ` (${record.errorCategory})` : ''}`
      : record.result.ok
        ? 'ok'
        : `failed: ${record.result.error.message}`;
    log(
      'action',
      `${record.instanceId}.${record.action} ${outcome}${record.reason ? ` ${record.reason}` : ''}`,
    );
  }
}

function readInitialStaleTimeout(argv: readonly string[]): number | undefined {
  const flagIndex = argv.indexOf('--stale');
  if (flagIndex === -1) return undefined;
  const parsed = parseStaleTimeout(argv[flagIndex + 1]);
  if (parsed === undefined) {
    console.error(`--stale needs ${STALE_VALUE_HINT}.\n\n${USAGE}`);
    process.exit(1);
  }
  return parsed;
}

function parseStaleTimeout(value: string | undefined): number | undefined {
  if (value === 'off') return Infinity;
  const parsed = Number(value);
  return parsed > 0 && parsed <= MAX_TIMER_DELAY_MS ? parsed : undefined;
}

function log(kind: string, detail: string): void {
  const elapsed = Math.round(performance.now() - startedAt);
  console.log(`+${elapsed}ms ${kind} ${detail}`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createLoggingConnector(): WebSocketConnector {
  return new (class extends WebSocketConnector {
    constructor() {
      super({ url });
      this.onEvent(logWireOnlyEvent);
    }

    override async sendInput(agentInput: AgentInput): Promise<void> {
      await super.sendInput(agentInput);
      if (agentInput.type !== 'ui_applied') return;
      const outcomes = agentInput.actionOutcomes.map((outcome) =>
        outcome.ok ? 'ok' : `failed(${outcome.error ?? ''})`,
      );
      log(
        'ui_applied sent',
        `changeId=${agentInput.changeId} instances=${agentInput.chart.instances.length} actionOutcomes=[${outcomes.join(', ')}]`,
      );
    }
  })();
}

function logWireOnlyEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'accepted':
      log(
        'wire accepted',
        `inputId=${event.inputId} runId=${event.runId} disposition=${event.disposition}`,
      );
      return;
    case 'started':
      log('wire started', `runId=${event.runId}`);
      return;
    case 'tool_call':
      log('wire tool_call', `runId=${event.runId} name=${event.name}`);
      return;
    case 'ui_change':
      log(
        'wire ui_change',
        `runId=${event.runId} changeId=${event.changeId} actions=${event.response.executionPlan.length}`,
      );
      return;
    default:
      return;
  }
}
