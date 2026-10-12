// PROTOTYPE (MAE-825, MAE-826): throwaway agent loop, never merge.
/**
 * Tools the Agent Session loop can call. Catalog and order lookups run on the
 * server from fixtures; cart reads and approvals run in the browser through
 * `agent.tool.request`; every screen change goes through the Planner. Data
 * tools queue their own show when they return. Cart and order tools hand the
 * Planner required actions the session enforces, so side effects never
 * depend on a model's guess.
 */
import type {
  ActionExecution,
  MaelstromResponse,
} from '@maelstrom-co/protocol';
import { type AnyTool, toolDefinition } from '@tanstack/ai';
import { z } from 'zod';
import {
  type Product,
  productBySku,
  SEED_ORDERS,
} from '../lib/pet-shop-fixtures';
import { findSimilarProducts, searchProducts } from '../vessels/catalog.store';
import type { PlannerCallOrigin, RequiredAction } from './agent-planner';
import type {
  AgentChartSnapshot,
  ClientToolName,
} from './agent-session-frames';

const toolEnv =
  typeof process !== 'undefined'
    ? process.env
    : ({} as Record<string, string | undefined>);

/**
 * Measurement only: `AGENT_DIRECT_PUSH=1` restores the MAE-825 direct pushes
 * (catalog actions, add_to_cart, place_order) that skip the Planner. Off by
 * default, and always off in the Worker: the Planner is the only path for UI
 * changes.
 */
export const DIRECT_PUSH = toolEnv.AGENT_DIRECT_PUSH?.trim() === '1';

export type ToolVisibility =
  | { readonly visibility: 'shown'; readonly label: string }
  | { readonly visibility: 'silent' };

/** One UI change a tool asks the Planner for. */
export interface ShowRequest {
  readonly origin: PlannerCallOrigin;
  readonly intent: string;
  /** Ids and SKUs the Planner should use, e.g. `{ latestOrderSkus, similarSkus }`. */
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly requiredActions?: readonly RequiredAction[];
}

export type ShowOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/** What a tool may do to the session it runs in. */
export interface AgentToolContext {
  /** Queues one Planner call and returns before it lands. */
  readonly show: (request: ShowRequest) => void;
  /** Queues one Planner call and resolves once the browser applied it. */
  readonly showAndWait: (request: ShowRequest) => Promise<ShowOutcome>;
  /** Resolves with the chart once every queued UI change is applied. */
  readonly waitForScreen: () => Promise<AgentChartSnapshot>;
  /** Measurement only ({@link DIRECT_PUSH}): pushes actions without the Planner. */
  readonly runActions: (
    executionPlan: readonly ActionExecution[],
    origin: PlannerCallOrigin,
  ) => Promise<AgentChartSnapshot>;
  readonly callClientTool: (
    tool: ClientToolName,
    args: unknown,
  ) => Promise<unknown>;
  /** Facts the session gathered so far, sent with free-form shows. */
  readonly facts: () => Readonly<Record<string, unknown>>;
  readonly rememberFacts: (facts: Record<string, unknown>) => void;
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
    run: async (_input, context) => {
      const orders = SEED_ORDERS.map((order) => ({
        orderId: order.id,
        placedOn: order.placedOn,
        items: order.items.map((item) => ({
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          fatPercent: productBySku(item.sku)?.fatPercent,
        })),
      }));
      const latest = orders[0];
      if (!latest) return { shown: 'nothing', orders };
      const facts = {
        latestOrderId: latest.orderId,
        latestOrderSkus: latest.items.map((item) => item.sku),
      };
      context.rememberFacts(facts);
      context.show({
        origin: 'get_past_orders',
        intent: `Open the customer's most recent order, ${latest.orderId}, in the orders vessel so they can see what they usually buy.`,
        metadata: facts,
      });
      return { shown: 'the most recent order, on screen shortly', orders };
    },
  }),
  defineAgentTool({
    name: 'search_products',
    description:
      'Search the pet-food catalog AND show the matches in the catalog on screen. Every field is optional and they combine. No show_ui call is needed for the results.',
    inputSchema: z.object({
      query: z.string().nullish().describe('Free text: brand, protein, need'),
      species: z.enum(['dog', 'cat']).nullish(),
      foodType: z.enum(['dry', 'wet']).nullish(),
      maxFatPercent: z.number().nullish(),
    }),
    visibility: { visibility: 'shown', label: 'Searching the catalog…' },
    run: async (input, context) => {
      const results = searchProducts(input).map(summarizeProduct);
      const intent = `Show the catalog with the search results for ${JSON.stringify(input)}.`;
      if (DIRECT_PUSH) {
        const shown = await showInCatalog(
          context,
          'search_products',
          'searchProducts',
          { ...input },
          intent,
        );
        return { shown, results };
      }
      const facts = {
        searchFilters: { ...input },
        searchResultSkus: results.map((product) => product.sku),
      };
      context.rememberFacts(facts);
      context.show({ origin: 'search_products', intent, metadata: facts });
      return { shown: 'the results, on screen shortly', results };
    },
  }),
  defineAgentTool({
    name: 'find_similar_products',
    description:
      'Find catalog products similar to a reference SKU (same species, food type, compatible life stage), leanest first, AND show them in the catalog on screen. Set lowerFatOnly for lower-fat alternatives. No show_ui call is needed for the results.',
    inputSchema: z.object({
      sku: z.string(),
      lowerFatOnly: z.boolean().nullish(),
      maxFatPercent: z.number().nullish(),
    }),
    visibility: { visibility: 'shown', label: 'Finding similar products…' },
    run: async ({ sku, lowerFatOnly, maxFatPercent }, context) => {
      const reference = productBySku(sku);
      if (!reference) return { error: `Unknown SKU ${sku}` };
      const filters = {
        ...(lowerFatOnly === undefined ? {} : { lowerFatOnly }),
        ...(maxFatPercent === undefined ? {} : { maxFatPercent }),
      };
      const similar = findSimilarProducts(reference, {
        lowerFatOnly,
        maxFatPercent,
      }).map(summarizeProduct);
      const intent = `Show the catalog with products similar to SKU ${reference.sku}${lowerFatOnly ? ' with lower fat' : ''}${maxFatPercent === undefined ? '' : ` at most ${maxFatPercent}% fat`}.`;
      if (DIRECT_PUSH) {
        const shown = await showInCatalog(
          context,
          'find_similar_products',
          'findSimilarProducts',
          { sku, ...filters },
          intent,
        );
        return { shown, reference: summarizeProduct(reference), similar };
      }
      const facts = {
        referenceSku: reference.sku,
        ...filters,
        similarSkus: similar.map((product) => product.sku),
      };
      context.rememberFacts(facts);
      context.show({
        origin: 'find_similar_products',
        intent,
        metadata: facts,
      });
      return {
        shown: 'the similar products, on screen shortly',
        reference: summarizeProduct(reference),
        similar,
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
      'Rearrange the screen through the layout planner. Describe the desired screen in plain words, naming the vessels (orders, catalog, cart, checkout) and any vessel action to run, e.g. "Open order ORD-10421 next to the catalog". Pass the order id or SKUs it is about. Do NOT use it for the latest order or catalog results (get_past_orders, search_products and find_similar_products show those) or cart changes (add_to_cart). Returns immediately; the screen updates in the background.',
    inputSchema: z.object({
      intent: z.string(),
      orderId: z
        .string()
        .nullish()
        .describe('Order id the change is about, if any.'),
      skus: z
        .array(z.string())
        .nullish()
        .describe('Product SKUs the change is about, if any.'),
    }),
    visibility: { visibility: 'shown', label: 'Arranging the screen…' },
    run: async ({ intent, orderId, skus }, context) => {
      context.show({
        origin: 'show_ui',
        intent,
        metadata: {
          ...context.facts(),
          ...(orderId ? { orderId } : {}),
          ...(skus && skus.length > 0 ? { skus } : {}),
        },
      });
      return 'Screen change requested; it will appear shortly. Continue.';
    },
  }),
  defineAgentTool({
    name: 'add_to_cart',
    description:
      'Add a catalog product to the cart (shows the cart if needed). Use it instead of show_ui for cart changes.',
    inputSchema: z.object({
      sku: z.string(),
      quantity: z.number().int().min(1).nullish(),
    }),
    visibility: { visibility: 'shown', label: 'Adding to your cart…' },
    run: async ({ sku, quantity }, context) => {
      const product = productBySku(sku);
      if (!product) return { ok: false, error: `Unknown SKU ${sku}` };
      const units = quantity ?? 1;
      if (DIRECT_PUSH) {
        const cartInstance = await ensureVesselOnScreen(
          context,
          'add_to_cart',
          'cart',
          'Show the cart vessel so the customer can see it.',
        );
        if (!cartInstance) return { ok: false, error: 'Cart is not on screen' };
        await context.runActions(
          [
            actionExecution(cartInstance, 'addToCart', {
              sku: product.sku,
              quantity: units,
            }),
          ],
          'add_to_cart',
        );
        return { ok: true, added: product.name, quantity: units };
      }
      const outcome = await context.showAndWait({
        origin: 'add_to_cart',
        intent: `Add ${units} x ${product.name} (SKU ${product.sku}) to the cart and keep the cart visible.`,
        metadata: { sku: product.sku, quantity: units },
        requiredActions: [
          {
            vesselId: 'cart',
            action: 'addToCart',
            params: { sku: product.sku, quantity: units },
          },
        ],
      });
      if (!outcome.ok) return { ok: false, error: outcome.error };
      return { ok: true, added: product.name, quantity: units };
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
        'place_order',
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
      if (DIRECT_PUSH) {
        await context.runActions(
          [actionExecution(checkoutInstance, 'placeOrder', {})],
          'place_order',
        );
        return { ok: true, placed: true };
      }
      const outcome = await context.showAndWait({
        origin: 'place_order',
        intent:
          'Place the order the customer just approved on the checkout and show its confirmation.',
        metadata: cart.totalText ? { cartTotal: cart.totalText } : {},
        requiredActions: [
          { vesselId: 'checkout', action: 'placeOrder', params: {} },
        ],
      });
      if (!outcome.ok) return { ok: false, error: outcome.error };
      return { ok: true, placed: true };
    },
  }),
];

export const AGENT_SYSTEM_PROMPT = `You are the shopping assistant for a pet-food store, driving a dynamic UI.
The customer is Sam Rivera (dog Biscuit, adult Labrador; cat Miso, indoor adult).
Rules:
- Look up data with get_past_orders, search_products, find_similar_products and get_cart. Never invent SKUs.
- get_past_orders puts the most recent order on screen, and search_products and find_similar_products put their results in the catalog on screen, by themselves as soon as they return. Never call show_ui for those.
- Change the screen otherwise ONLY with show_ui, add_to_cart and place_order. Use show_ui only for layout changes no other tool covers (for example opening an older order, product details or resizing). show_ui is asynchronous: call it at most once per request, pass the order id or SKUs it is about, then keep working.
- Never place an order without place_order, which asks the customer for approval itself. Only call place_order when the customer asked to check out or buy.
- Messages starting with [screen] are notes from the UI about what the screen shows now, not words from the customer.
- Before each group of tool calls, write one short sentence saying what you are doing (it is shown as progress).
- Finish with one or two short sentences for the customer. No markdown.`;

/**
 * Appended to {@link AGENT_SYSTEM_PROMPT} when the loop model may call
 * several tools in one turn.
 */
export const PARALLEL_TOOLS_HINT = `- Request lookups that do not depend on each other in the same turn, as parallel tool calls: for example get_past_orders together with search_products, or get_past_orders together with get_cart. Wait for a result only when the next call needs a value from it, such as a SKU from the past orders for find_similar_products.`;

function defineAgentTool<TSchema extends z.ZodObject>(spec: {
  name: string;
  description: string;
  inputSchema: TSchema;
  visibility: ToolVisibility;
  run: (
    input: WithoutNulls<z.infer<TSchema>>,
    context: AgentToolContext,
  ) => Promise<unknown>;
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
          return await spec.run(
            withoutNulls(input as z.infer<TSchema>),
            context,
          );
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

// OpenAI strict tool schemas make every optional field required and
// nullable, so the model sends null for "not set".
type WithoutNulls<T> = { [K in keyof T]: Exclude<T[K], null> };

function withoutNulls<T extends object>(input: T): WithoutNulls<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== null),
  ) as WithoutNulls<T>;
}

/** The first visible instance of `vesselId`, or null. */
export function visibleInstanceOf(
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

/** `chart` with `layout` applied; a tiling layout also declares the instances. */
export function chartWithLayout(
  chart: AgentChartSnapshot,
  layout: MaelstromResponse['layout'],
): AgentChartSnapshot {
  return {
    ...chart,
    layout,
    instances:
      layout.type === 'tiling'
        ? layout.instances.map(({ instanceId, vesselId, variant }) => ({
            instanceId,
            vesselId,
            variant,
          }))
        : chart.instances,
  };
}

export function actionExecution(
  instanceId: string,
  action: string,
  params: Record<string, unknown>,
): ActionExecution {
  // MaelstromResponse actions carry parsed `params`; `paramsJson` is only the
  // LLM structured-output shape, and the browser ignores it.
  return { instanceId, action, params } as unknown as ActionExecution;
}

// Measurement only (DIRECT_PUSH): bypasses the Planner when the catalog is
// already visible.
async function showInCatalog(
  context: AgentToolContext,
  origin: PlannerCallOrigin,
  action: string,
  params: Record<string, unknown>,
  fallbackIntent: string,
): Promise<'catalog' | 'queued'> {
  const chart = await context.waitForScreen();
  const catalogInstance = visibleInstanceOf(chart, 'catalog');
  if (!catalogInstance) {
    context.show({ origin, intent: fallbackIntent, metadata: { ...params } });
    return 'queued';
  }
  await context.runActions(
    [actionExecution(catalogInstance, action, params)],
    origin,
  );
  return 'catalog';
}

async function ensureVesselOnScreen(
  context: AgentToolContext,
  origin: PlannerCallOrigin,
  vesselId: string,
  intent: string,
): Promise<string | null> {
  const before = await context.waitForScreen();
  const existing = visibleInstanceOf(before, vesselId);
  if (existing) return existing;
  await context.showAndWait({
    origin,
    intent,
    metadata: context.facts(),
  });
  return visibleInstanceOf(await context.waitForScreen(), vesselId);
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
