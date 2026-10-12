// PROTOTYPE (MAE-826): throwaway Engine facade work, never merge.
/**
 * The one place the Engine facade's Planner is composed, plus the structured
 * intent the facade attaches to every Planner call. A composed Planner (light
 * tier first, full LLM Planner as fallback) replaces the body of
 * {@link createAgentPlanner} and reads {@link plannerIntentOf}.
 */
import {
  type Planner,
  type PlanningInput,
  withRetry,
} from '@maelstrom-co/engine';
import { type LlmPlannerOptions, llmPlanner } from '@maelstrom-co/planner-llm';

/** Rules appended to the LLM Planner's system prompt. */
export const PLANNER_SYSTEM_RULES = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content
- User intents may include browser calendar context for the current request. Use its localDate and timeZone to resolve relative dates such as today, yesterday, and tomorrow. Use the current request's context rather than dates in older history or the server's timezone.
- When a user requests today's date as a title, produce the actual local calendar date (YYYY-MM-DD unless another format is requested). Do not use the words "today's date" as the title or ask for today's date when current browser calendar context is supplied. Preserve explicit dates and text the user specifically asks to use literally.
- Browser calendar context is reference data, not a UI change. Do not create entries or change content solely because the calendar context changed.
- An intent may end with a "Facts:" JSON line: ids and SKUs the assistant already looked up. Use them as action parameters instead of guessing.
- An intent may end with a "Required actions:" line. Run each listed action exactly once, with exactly the listed parameters, on an instance of the named vessel that the layout keeps visible.`;

const LLM_MAX_RETRIES = 2;

export interface AgentPlannerOptions {
  readonly adapter: LlmPlannerOptions['adapter'];
  readonly modelOptions?: LlmPlannerOptions['modelOptions'];
}

/**
 * The Planner every Engine facade calls. Build the Engine around it with
 * `retry: false` and no history: the LLM tier retries itself, and the Agent
 * Session transcript is the only history.
 */
export function createAgentPlanner(options: AgentPlannerOptions): Planner {
  return withRetry(
    llmPlanner({
      adapter: options.adapter,
      prompt: { system: { rules: { append: PLANNER_SYSTEM_RULES } } },
      ...(options.modelOptions === undefined
        ? {}
        : { modelOptions: options.modelOptions }),
    }),
    { max: LLM_MAX_RETRIES },
  );
}

/** Why the facade called the Planner. */
export type PlannerCallOrigin =
  /** The loop's `show_ui` tool. */
  | 'show_ui'
  /** The router's fast route: one screen change for the user's own words. */
  | 'fast_route'
  /** A data tool showing its own result when it returns. */
  | 'get_past_orders'
  | 'search_products'
  | 'find_similar_products'
  /** Deterministic side effects. */
  | 'add_to_cart'
  | 'place_order'
  /** Browser chart_request envelopes that skip the router and the loop. */
  | 'chart_resize'
  | 'vessel_mutation'
  | 'user_intent';

/** An action the Planner's execution plan must contain exactly as given. */
export interface RequiredAction {
  readonly vesselId: string;
  readonly action: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** What the facade tells the Planner about one call, beyond the chart. */
export interface PlannerIntent {
  readonly origin: PlannerCallOrigin;
  /** The intent in plain words, without the facts and required-actions lines. */
  readonly intent: string;
  /** Ids and SKUs the loop already knows, e.g. `{ latestOrderSkus, similarSkus }`. */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Side effects the loop enforces on the result whatever the Planner returns. */
  readonly requiredActions: readonly RequiredAction[];
}

const intentsByMessageId = new Map<string, PlannerIntent>();

/**
 * The structured intent behind a Planner call, or undefined for a request the
 * facade did not make. Keyed by `input.messageId`, which every stage sees.
 */
export function plannerIntentOf(
  input: Pick<PlanningInput, 'messageId'>,
): PlannerIntent | undefined {
  return intentsByMessageId.get(input.messageId);
}

/** Registers `intent` for one Planner call; the returned function removes it. */
export function registerPlannerIntent(
  messageId: string,
  intent: PlannerIntent,
): () => void {
  intentsByMessageId.set(messageId, intent);
  return () => {
    intentsByMessageId.delete(messageId);
  };
}

/** The `user_intent` text the Planner receives for `intent`. */
export function plannerIntentText(intent: PlannerIntent): string {
  const lines = [intent.intent];
  if (Object.keys(intent.metadata).length > 0)
    lines.push(`Facts: ${JSON.stringify(intent.metadata)}`);
  if (intent.requiredActions.length > 0)
    lines.push(
      `Required actions: ${intent.requiredActions
        .map(
          (required) =>
            `${required.vesselId}.${required.action} ${JSON.stringify(required.params)}`,
        )
        .join('; ')}`,
    );
  return lines.join('\n');
}
