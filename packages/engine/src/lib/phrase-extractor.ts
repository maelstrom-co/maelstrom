import { chat } from '@tanstack/ai';
import { geminiText } from '@tanstack/ai-gemini';

const phraseExtractorAdapter = geminiText('gemini-2.5-flash');

function normalizePhrase(line: string): string {
  return (
    line
      // this replaces common list prefixes like "1. ", "- ", "* ", etc.
      .replace(/^[-*\d.\s)]+/, '')
      // this removes surrounding quotes, backticks, or whitespace
      .replace(/^['"`]+|['"`]+$/g, '')
      .trim()
  );
}

function parsePhrases(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map((line) => normalizePhrase(line))
        .filter((line) => line.length > 0),
    ),
  );
}

export async function extractImportantPhrasesFromConversation(
  conversation: string,
): Promise<string[]> {
  if (!conversation.trim()) {
    return [];
  }

  const response = await chat({
    adapter: phraseExtractorAdapter,
    messages: [
      {
        role: 'user',
        content: `Conversation:\n${conversation}`,
      },
      {
        role: 'user',
        content:
          'prepare the prhases out of the conversation. Return only phrases, one per line, no numbering.',
      },
    ],
    stream: false,
  });

  return parsePhrases(response);
}
