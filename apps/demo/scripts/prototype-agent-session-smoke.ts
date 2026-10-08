// PROTOTYPE (MAE-825): throwaway agent loop, never merge.
// Drives the local ws-server's Agent Session over a real WebSocket, playing
// the browser: applies agent.ui to a simulated chart, answers client tools,
// and prints the frame sequence with timestamps plus agent.done metrics.
// Usage: bun run scripts/prototype-agent-session-smoke.ts "prompt one" "prompt two"
import type { TilingLayout } from '@maelstrom-co/protocol';
import { SHOP_LAYOUT } from '../src/lib/default-layout';
import {
  calculateOrderTotals,
  productBySku,
} from '../src/lib/pet-shop-fixtures';
import type {
  AgentChartSnapshot,
  AgentServerFrame,
} from '../src/server/agent-session-frames';
import { cartVessel } from '../src/vessels/cart.vessel.def';
import { catalogVessel } from '../src/vessels/catalog.vessel.def';
import { checkoutVessel } from '../src/vessels/checkout.vessel.def';
import { ordersVessel } from '../src/vessels/orders.vessel.def';

const prompts = process.argv.slice(2);
const url = process.env.WS_URL ?? 'ws://localhost:3001/ws';
let chart: AgentChartSnapshot = {
  sessionId: `smoke-${Date.now()}`,
  chartDimensions: { rows: 12, columns: 16 },
  layoutMode: 'tiling',
  instances: SHOP_LAYOUT.instances,
  vessels: [ordersVessel, catalogVessel, cartVessel, checkoutVessel] as never,
  layout: SHOP_LAYOUT,
};
let cart: {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}[] = [];

const ws = new WebSocket(url);
let turnStarted = 0;
let resolveTurn: () => void = () => {};

ws.onmessage = (event) => {
  const frame = JSON.parse(String(event.data)) as AgentServerFrame;
  const at = `+${Math.round(performance.now() - turnStarted)}ms`.padStart(8);
  switch (frame.type) {
    case 'agent.progress':
      console.log(
        at,
        'agent.progress',
        JSON.stringify(frame.text),
        frame.tool ?? '',
      );
      return;
    case 'agent.tool.request': {
      console.log(
        at,
        'agent.tool.request',
        frame.tool,
        JSON.stringify(frame.args),
      );
      const value =
        frame.tool === 'ask_user'
          ? { approved: true }
          : {
              lines: cart,
              totalText: `$${(calculateOrderTotals(cart).totalCents / 100).toFixed(2)}`,
            };
      ws.send(
        JSON.stringify({
          type: 'agent.tool.result',
          callId: frame.callId,
          ok: true,
          value,
        }),
      );
      return;
    }
    case 'agent.ui': {
      const actions = frame.executionPlan.map(
        (a) => `${a.action}${a.paramsJson ?? ''}`,
      );
      console.log(
        at,
        'agent.ui',
        frame.source,
        frame.layout ? 'layout' : 'no-layout',
        JSON.stringify(actions),
        JSON.stringify(frame.userMessage),
      );
      applyUi(frame);
      ws.send(
        JSON.stringify({ type: 'agent.ui.applied', uiId: frame.uiId, chart }),
      );
      return;
    }
    case 'agent.done':
      console.log(
        at,
        'agent.done',
        frame.ok,
        JSON.stringify(frame.reply),
        frame.error ?? '',
      );
      console.log(JSON.stringify(frame.metrics, null, 2));
      resolveTurn();
      return;
    default:
      console.log(at, 'other', String(event.data).slice(0, 200));
      if (String(event.data).includes('engine.error')) process.exit(1);
  }
};

await new Promise((resolve) => {
  ws.onopen = resolve;
});
for (const prompt of prompts) {
  console.log(`\n=== ${prompt}`);
  turnStarted = performance.now();
  const done = new Promise<void>((resolve) => {
    resolveTurn = resolve;
  });
  ws.send(
    JSON.stringify({
      type: 'agent.input',
      input: { kind: 'user_text', text: prompt },
      chart,
    }),
  );
  const timedOut = await Promise.race([
    done.then(() => false),
    Bun.sleep(180_000).then(() => true),
  ]);
  if (timedOut) {
    console.log('TURN TIMEOUT');
    process.exit(1);
  }
}
console.log('\nfinal cart', JSON.stringify(cart));
ws.close();

function applyUi(frame: Extract<AgentServerFrame, { type: 'agent.ui' }>): void {
  if (frame.layout) {
    const layout = frame.layout as TilingLayout;
    chart = {
      ...chart,
      layout,
      instances: layout.instances ?? chart.instances,
    };
  }
  for (const action of frame.executionPlan) {
    const params = action.paramsJson ? JSON.parse(action.paramsJson) : {};
    if (action.action === 'addToCart') {
      const product = productBySku(params.sku);
      if (!product) continue;
      cart = [
        ...cart,
        {
          sku: product.sku,
          name: product.name,
          quantity: params.quantity ?? 1,
          unitPriceCents: product.priceCents,
        },
      ];
    }
    if (action.action === 'placeOrder') cart = [];
  }
}
