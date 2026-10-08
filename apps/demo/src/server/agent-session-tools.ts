// PROTOTYPE (MAE-825): throwaway agent loop, never merge.
/**
 * Tools the Agent Session loop can call. Catalog and order lookups run on the
 * server from fixtures; cart reads and approvals run in the browser through
 * `agent.tool.request`; every screen change goes through the Planner or a
 * direct `agent.ui` action push.
 */
import type { ActionExecution } from '@maelstrom-co/protocol';
import { type AnyTool, toolDefinition } from '@tanstack/ai';
import { z } from 'zod';
import {
  type Product,
  productBySku,
  SEED_ORDERS,
} from '../lib/pet-shop-fixtures';
import { findSimilarProducts, searchProducts } from '../vessels/catalog.store';
import type {
  AgentChartSnapshot,
  ClientToolName,
} from './agent-session-frames';

export type ToolVisibility =
  | { readonly visibility: 'shown'; readonly label: string }
  | { readonly visibility: 'silent' };

/** What a tool may do to the session it runs in. */
export interface AgentToolContext {
  /** Asks the Planner for one UI change and returns before it lands. */
  readonly showUi: (intent: string) => string;
  /** Resolves with the chart once every UI change sent so far is applied. */
  readonly waitForScreen: () => Promise<AgentChartSnapshot>;
  /** Runs a Planner call and waits until the browser applied it. */
  readonly showUiAndWait: (intent: string) => Promise<AgentChartSnapshot>;
  /** Pushes vessel actions without a layout change and waits for them to apply. */
  readonly runActions: (
    executionPlan: readonly ActionExecution[],
  ) => Promise<AgentChartSnapshot>;
  readonly callClientTool: (
    tool: ClientToolName,
    args: unknown,
  ) => Promise<unknown>;
}

/** Hooks the session wraps every tool call with, for progress and timing. */
export interface AgentToolHooks {
  readonly onToolStart: (name: string, visibility: ToolVisibility) => void;
  readonly onToolEnd: (name: string, ms: number) => void;
}

export interface AgentTool {
  readonly name: string;
  readonly visibility: ToolVisibility;
  readonly bind: (context: AgentToolContext, hooks: AgentToolHooks) => AnyTool;
}

export const AGENT_TOOLS: readonly AgentTool[] = [
  defineAgentTool({
    name: 'get_past_orders',
    description:
      "List the customer's past pet-food orders, newest first, with every line item SKU, product name, quantity and price. Use it to find what they usually buy.",
    inputSchema: z.object({}),
    visibility: { visibility: 'shown', label: 'Looking up your past orders…' },
    run: async () =>
      SEED_ORDERS.map((order) => ({
        orderId: order.id,
        placedOn: order.placedOn,
        items: order.items.map((item) => ({
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          fatPercent: productBySku(item.sku)?.fatPercent,
        })),
      })),
  }),
  defineAgentTool({
    name: 'search_products',
    description:
      'Search the pet-food catalog. Every field is optional and they combine.',
    inputSchema: z.object({
      query: z.string().optional().describe('Free text: brand, protein, need'),
      species: z.enum(['dog', 'cat']).optional(),
      foodType: z.enum(['dry', 'wet']).optional(),
      maxFatPercent: z.number().optional(),
    }),
    visibility: { visibility: 'shown', label: 'Searching the catalog…' },
    run: async (input) => searchProducts(input).map(summarizeProduct),
  }),
  defineAgentTool({
    name: 'find_similar_products',
    description:
      'Find catalog products similar to a reference SKU (same species, food type, compatible life stage), leanest first. Set lowerFatOnly for lower-fat alternatives.',
    inputSchema: z.object({
      sku: z.string(),
      lowerFatOnly: z.boolean().optional(),
      maxFatPercent: z.number().optional(),
    }),
    visibility: { visibility: 'shown', label: 'Finding similar products…' },
    run: async ({ sku, lowerFatOnly, maxFatPercent }) => {
      const reference = productBySku(sku);
      if (!reference) return { error: `Unknown SKU ${sku}` };
      return {
        reference: summarizeProduct(reference),
        similar: findSimilarProducts(reference, {
          lowerFatOnly,
          maxFatPercent,
        }).map(summarizeProduct),
      };
    },
  }),
  defineAgentTool({
    name: 'get_cart',
    description:
      "Read the customer's current cart (lines and totals) from their browser.",
    inputSchema: z.object({}),
    visibility: { visibility: 'silent' },
    run: (_input, context) => context.callClientTool('get_cart', {}),
  }),
  defineAgentTool({
    name: 'ask_user',
    description:
      'Ask the customer a yes/no question in their browser and wait for the answer.',
    inputSchema: z.object({ question: z.string() }),
    visibility: { visibility: 'shown', label: 'Waiting for your answer…' },
    run: (input, context) => context.callClientTool('ask_user', input),
  }),
  defineAgentTool({
    name: 'show_ui',
    description:
      'Change what is on screen. Describe the desired screen in plain words, naming the vessels (orders, catalog, cart, checkout) and any vessel action to run, e.g. "Show the catalog with products similar to SKU X with lower fat, next to the orders list". Returns immediately; the screen updates in the background. Call it once per distinct screen change, as soon as you know what to show.',
    inputSchema: z.object({ intent: z.string() }),
    visibility: { visibility: 'shown', label: 'Arranging the screen…' },
    run: async ({ intent }, context) => context.showUi(intent),
  }),
  defineAgentTool({
    name: 'add_to_cart',
    description:
      'Add a catalog product to the cart (shows the cart if needed). Use it instead of show_ui for cart changes.',
    inputSchema: z.object({
      sku: z.string(),
      quantity: z.number().int().min(1).optional(),
    }),
    visibility: { visibility: 'shown', label: 'Adding to your cart…' },
    run: async ({ sku, quantity }, context) => {
      const product = productBySku(sku);
      if (!product) return { ok: false, error: `Unknown SKU ${sku}` };
      const cartInstance = await ensureVesselOnScreen(
        context,
        'cart',
        'Show the cart vessel so the customer can see it.',
      );
      if (!cartInstance) return { ok: false, error: 'Cart is not on screen' };
      await context.runActions([
        actionExecution(cartInstance, 'addToCart', {
          sku: product.sku,
          quantity: quantity ?? 1,
        }),
      ]);
      return { ok: true, added: product.name, quantity: quantity ?? 1 };
    },
  }),
  defineAgentTool({
    name: 'place_order',
    description:
      'Place the order for everything in the cart. Asks the customer for approval first and only places it when they approve.',
    inputSchema: z.object({}),
    visibility: { visibility: 'shown', label: 'Preparing checkout…' },
    run: async (_input, context) => {
      const checkoutInstance = await ensureVesselOnScreen(
        context,
        'checkout',
        'Show the checkout review vessel next to the cart.',
      );
      if (!checkoutInstance)
        return { ok: false, error: 'Checkout is not on screen' };
      const cart = (await context.callClientTool('get_cart', {})) as {
        lines?: readonly unknown[];
        totalText?: string;
      };
      if (!cart.lines || cart.lines.length === 0)
        return { ok: false, error: 'Cart is empty' };
      const answer = (await context.callClientTool('ask_user', {
        question: `Place this order for ${cart.totalText ?? 'the cart total'}?`,
      })) as { approved?: boolean };
      if (!answer.approved) return { ok: false, declined: true };
      await context.runActions([
        actionExecution(checkoutInstance, 'placeOrder', {}),
      ]);
      return { ok: true, placed: true };
    },
  }),
];

export const AGENT_SYSTEM_PROMPT = `You are the shopping assistant for a pet-food store, driving a dynamic UI.
The customer is Sam Rivera (dog Biscuit, adult Labrador; cat Miso, indoor adult).
Rules:
- Look up data with get_past_orders, search_products, find_similar_products and get_cart. Never invent SKUs.
- Change the screen ONLY with show_ui, add_to_cart and place_order. show_ui is asynchronous: call it as soon as you know what to show, then keep working.
- Show early: as soon as one lookup tells you what the customer will want to see, call show_ui in that same step (you may call it together with the next lookup), instead of waiting until the end.
- Show the customer what you found (for example the similar lower-fat products in the catalog) before you act on it.
- Never place an order without place_order, which asks the customer for approval itself. Only call place_order when the customer asked to check out or buy.
- Before each group of tool calls, write one short sentence saying what you are doing (it is shown as progress).
- Finish with one or two short sentences for the customer. No markdown.`;

function defineAgentTool<TSchema extends z.ZodObject>(spec: {
  name: string;
  description: string;
  inputSchema: TSchema;
  visibility: ToolVisibility;
  run: (input: z.infer<TSchema>, context: AgentToolContext) => Promise<unknown>;
}): AgentTool {
  return {
    name: spec.name,
    visibility: spec.visibility,
    bind: (context, hooks) =>
      toolDefinition({
        name: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema,
      }).server(async (input) => {
        hooks.onToolStart(spec.name, spec.visibility);
        const started = performance.now();
        try {
          return await spec.run(input as z.infer<TSchema>, context);
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        } finally {
          hooks.onToolEnd(spec.name, performance.now() - started);
        }
      }) as AnyTool,
  };
}

async function ensureVesselOnScreen(
  context: AgentToolContext,
  vesselId: string,
  intent: string,
): Promise<string | null> {
  const before = await context.waitForScreen();
  const existing = visibleInstanceOf(before, vesselId);
  if (existing) return existing;
  const after = await context.showUiAndWait(intent);
  return visibleInstanceOf(after, vesselId);
}

function visibleInstanceOf(
  chart: AgentChartSnapshot,
  vesselId: string,
): string | null {
  // A tiling layout declares hidden instances too; only tree leaves are visible.
  const placed = JSON.stringify(
    'tree' in chart.layout ? chart.layout.tree : chart.layout,
  );
  return (
    chart.instances.find(
      (instance) =>
        instance.vesselId === vesselId && placed.includes(instance.instanceId),
    )?.instanceId ?? null
  );
}

function actionExecution(
  instanceId: string,
  action: string,
  params: Record<string, unknown>,
): ActionExecution {
  // MaelstromResponse actions carry parsed `params`; `paramsJson` is only the
  // LLM structured-output shape, and the browser ignores it.
  return { instanceId, action, params } as unknown as ActionExecution;
}

function summarizeProduct(product: Product) {
  return {
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    species: product.species,
    foodType: product.foodType,
    lifeStage: product.lifeStage,
    size: product.size,
    price: `$${(product.priceCents / 100).toFixed(2)}`,
    fatPercent: product.fatPercent,
    proteinPercent: product.proteinPercent,
  };
}
