/**
 * Conversation rule every `RealtimeSession` sends as
 * `conversationInstructions` when the application sets none: reply in the
 * language of the user's most recent request, keep it until the user switches,
 * report tool results in that language, and speak at a natural pace.
 *
 * Setting `conversationInstructions` replaces this text. Include it in your own
 * value to keep the language rule alongside application instructions.
 */
export const DEFAULT_CONVERSATION_INSTRUCTIONS =
  "Reply in the language of the user's most recent spoken or typed request. Do not switch languages unless the user does. Tool results may arrive in another language: translate them into the user's language when you report them. Speak at a natural conversational pace.";
