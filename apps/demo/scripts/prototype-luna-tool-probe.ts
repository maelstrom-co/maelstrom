// PROTOTYPE (MAE-825): throwaway agent loop, never merge.
import { chat, maxIterations, toolDefinition } from '@tanstack/ai';
import { z } from 'zod';
import { createDemoOpenaiChat } from '../src/server/engine-model';

const getWeather = toolDefinition({
  name: 'get_weather',
  description: 'Get the weather for a city',
  inputSchema: z.object({ city: z.string() }),
}).server(async ({ city }) => ({ city, tempC: 18, sky: 'cloudy' }));

const adapter = createDemoOpenaiChat(process.env.OPENAI_API_KEY ?? '');
for (const effort of [undefined, 'none', 'low', 'medium']) {
  const started = performance.now();
  let toolCalls = 0;
  try {
    const text = await chat({
      adapter,
      messages: [
        {
          role: 'user',
          content: 'What is the weather in Krakow? Use the tool.',
        },
      ],
      tools: [getWeather],
      agentLoopStrategy: maxIterations(4),
      stream: false,
      middleware: [
        {
          onAfterToolCall: () => {
            toolCalls++;
          },
        },
      ],
      ...(effort ? { modelOptions: { reasoning: { effort } } } : {}),
    } as Parameters<typeof chat>[0]);
    console.log(
      effort ?? 'default',
      'toolCalls',
      toolCalls,
      Math.round(performance.now() - started),
      'ms',
      String(text).slice(0, 80),
    );
  } catch (error) {
    console.log(
      effort ?? 'default',
      'ERROR',
      error instanceof Error ? error.message.slice(0, 300) : error,
    );
  }
}
