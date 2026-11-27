/**
 * Conversation rule every `RealtimeSession` hands its adapter as
 * `conversationInstructions` when the application sets none: reply in the
 * language of the user's most recent spoken request, keep it until the user
 * switches, report tool results in that language, and speak at a natural pace.
 *
 * The rule covers speech only. Typed requests go to the Engine and never reach
 * the voice model, so they do not change the reply language.
 *
 * Only adapters with a conversational model apply it. The OpenAI Realtime and
 * GPT Live adapters do. The LiveKit adapter ignores it, because its worker
 * runs no LLM.
 *
 * Setting `conversationInstructions` replaces this text. Include it in your own
 * value to keep the language rule alongside application instructions.
 */
export const DEFAULT_CONVERSATION_INSTRUCTIONS =
  "Reply in the language of the user's most recent spoken request. Do not switch languages unless the user does. Tool results may arrive in another language: translate them into the user's language when you report them. Speak at a natural conversational pace.";
