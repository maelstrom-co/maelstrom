# @maelstrom-co/engine

The Maelstrom decision engine.

This package contains the core logic that processes user intent and produces execution plans. It's a pure decision layer: receives context, calls an LLM, and returns structured decisions. No transport handling, no state management.

---

## Installation

```bash
npm install @maelstrom-co/engine
```

---

## Quick Start

```typescript
import { createEngine, AnthropicProvider } from '@maelstrom-co/engine';

const engine = createEngine({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
});

const response = await engine.process(request);
// response.executionPlan: actions to execute
// response.layoutDirective: where to position Vessels
```

---

## API

### createEngine

```typescript
interface EngineConfig {
  /** LLM provider instance */
  provider: LLMProvider;

  /** Custom system prompt (optional) */
  systemPrompt?: string;

  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

function createEngine(config: EngineConfig): Engine;
```

### Engine

```typescript
interface Engine {
  /**
   * Process a chart request and return decisions
   */
  process(request: ChartRequest): Promise<MaelstromResponse>;
}
```

---

## LLM Providers

The engine is provider-agnostic. Implement the `LLMProvider` interface or use built-in providers.

### Interface

```typescript
interface LLMProvider {
  /**
   * Send a prompt to the LLM and get a response
   */
  complete(prompt: string, systemPrompt: string): Promise<string>;
}
```

### AnthropicProvider

```typescript
import { AnthropicProvider } from '@maelstrom-co/engine';

const provider = new AnthropicProvider({
  apiKey: 'sk-...',
  model: 'claude-sonnet-4-20250514', // default
});
```

### OpenAIProvider

```typescript
import { OpenAIProvider } from '@maelstrom-co/engine';

const provider = new OpenAIProvider({
  apiKey: 'sk-...',
  model: 'gpt-4', // default
});
```

### Custom Provider

```typescript
const customProvider: LLMProvider = {
  async complete(prompt, systemPrompt) {
    // Call your LLM
    return responseText;
  },
};
```

---

## Prompt Construction

The engine builds a prompt from the `ChartRequest`:

1. **System prompt** - Defines Maelstrom's role and response format
2. **Vessel definitions** - All registered Vessels with their variants and actions
3. **Current state** - Visible instances, their variants, positions
4. **User intent** - What the user wants to do

### Example Prompt

```
You are Maelstrom, an AI that orchestrates UI components called Vessels.

## Available Vessels

### calendar - Calendar
Calendar for scheduling and date selection.

Variants:
- month (4×4 min): Month view
  Actions: showWeek → week, collapse → collapsed, refresh
- week (6×3 min): Week view
  Actions: showMonth → month, selectDay(date) → day
- day (3×5 min): Day detail
  Actions: back → week
- collapsed (2×1 min): Minimized
  Actions: expand → month

### weather - Weather Widget
Shows weather information.

Variants:
- current (2×2 min): Current conditions only
  Actions: showForecast → forecast
- forecast (4×3 min): Extended forecast
  Actions: showCurrent → current

---

## Current Chart

Dimensions: 15 cols × 10 rows

Instances:
- calendar-1 (calendar) at (0,0) 4×4, variant: month
- weather-1 (weather) at (5,0) 2×2, variant: current

---

## User Intent

"Show me the weekly calendar and weather forecast"

---

Respond with JSON:
{
  "rationale": "Explanation of your decision",
  "executionPlan": [
    { "instanceId": "...", "action": "...", "params": {...} }
  ],
  "layoutDirective": [
    { "instanceId": "...", "position": { "x": 0, "y": 0 }, "size": { "w": 4, "h": 4 } }
  ]
}
```

---

## Response Parsing

The engine extracts JSON from the LLM response:

1. Find JSON block (between ```json and ``` or raw JSON)
2. Parse and validate against expected schema
3. Return structured `MaelstromResponse`

Validation includes:
- Action exists for current variant
- Target variant exists (if transitionsTo specified)
- Position/size are valid numbers
- Size meets variant's minSize

---

## Error Handling

```typescript
try {
  const response = await engine.process(request);
} catch (error) {
  if (error instanceof EngineError) {
    switch (error.code) {
      case 'LLM_ERROR':
        // Provider returned an error
        break;
      case 'PARSE_ERROR':
        // Failed to parse LLM response
        break;
      case 'VALIDATION_ERROR':
        // Response failed validation
        break;
      case 'TIMEOUT':
        // Request timed out
        break;
    }
  }
}
```

---

## Building

```bash
nx build engine
```

## Testing

```bash
nx test engine
```
