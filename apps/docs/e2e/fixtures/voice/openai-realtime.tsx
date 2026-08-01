import {
  OpenAIAdapter,
  type OpenAITokenGrant,
  OpenAITokenGrantSchema,
} from '@maelstrom-co/realtime-openai';

declare function getCsrfToken(): string;

/* docs:openai-browser-grant:start */
export async function mintOpenAIToken(): Promise<OpenAITokenGrant> {
  const response = await fetch('/api/realtime-token', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Token mint failed with status ${response.status}`);
  }

  return OpenAITokenGrantSchema.parse(await response.json());
}
/* docs:openai-browser-grant:end */

/* docs:openai-adapter-setup:start */
export function createOpenAIAdapter(): OpenAIAdapter {
  return new OpenAIAdapter({
    mintToken: mintOpenAIToken,
  });
}
/* docs:openai-adapter-setup:end */
