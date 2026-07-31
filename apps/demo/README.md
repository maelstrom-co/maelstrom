# Maelstrom Demo

The Maelstrom demo is a day-planner UI. An LLM arranges the board ([Chart](https://docs.maelstrom-ai.co/getting-started/core-concepts/)) from what you type or say. Voice is optional and joins the same Engine path once speech becomes an intent.

## Prerequisites

Before starting, install or confirm the following:

- Git
- [Bun](https://bun.sh/docs/installation) 1.3.7 or later
- Node.js 24, as specified by the repository's `.nvmrc` and CI configuration
- free local ports 3000 and 3001
- outbound network access to Gemini; weather and map data also use optional external services
- a [Google AI Studio](https://aistudio.google.com/apikey) Gemini API key for the typed demo

The typed demo does not require microphone permission, an OpenAI key, a LiveKit server, Deepgram, or Cartesia.

## Start the typed demo

Clone the repository from its public Git URL, then change into the clone directory:

```bash
git clone https://github.com/maelstrom-co/maelstrom
cd maelstrom
```

The clone directory is the repository root. Every remaining command in this walkthrough runs there.

From the repository root, install the workspace dependencies:

```bash
bun install
```

From the repository root, create your local environment file:

```bash
cp .env.example .env
```

Edit `.env` and set `GOOGLE_API_KEY` to your Gemini API key. The Engine falls back to `GEMINI_API_KEY` when `GOOGLE_API_KEY` is absent, so you may add and use the fallback name instead. If you use `GEMINI_API_KEY`, the empty `GOOGLE_API_KEY=` line copied from `.env.example` may remain in `.env`; the runtime treats its empty value as absent. Only one of these keys is required for the typed demo:

```dotenv
GOOGLE_API_KEY=<redacted>
```

The repository ignores `.env`. Never commit it or paste its contents into logs, issues, or other shared material. Keep examples empty or redacted as shown above.

From the repository root, start both demo processes:

```bash
bunx nx dev demo
```

The command builds the required workspace packages, then starts:

- Vite at `http://localhost:3000`
- the Bun Engine WebSocket host at `ws://localhost:3001/ws`

The terminal is ready when the Vite output shows `http://localhost:3000` and the Engine host output shows `ws://localhost:3001/ws`. Neither process should exit.

Open http://localhost:3000. When the status shows `connected`, type something like "Clear all this — just show me today" and submit. The board should rearrange in response.

## Optional: OpenAI realtime voice

OpenAI realtime voice is optional. The typed demo works without voice and does not request microphone permission unless you use the voice orb.

Create an [OpenAI API key](https://platform.openai.com/api-keys), then add the following to `.env` from the repository root:

```dotenv
OPENAI_API_KEY=<redacted>
# Optional model override; omit it to use gpt-realtime-2.
OPENAI_REALTIME_MODEL=
```

Keep the API key only in the ignored `.env` file. The demo's server-side minter uses it to create a short-lived browser credential; do not expose the API key in browser code or shared output. Start the demo with `bunx nx dev demo`, allow microphone access when the browser asks, and use the voice orb.

## Optional: LiveKit cascade voice

The LiveKit cascade is also optional. It requires a local LiveKit server plus real [Deepgram](https://console.deepgram.com/signup) and [Cartesia](https://play.cartesia.ai/) credentials.

1. Install and run a LiveKit server in development mode:

   ```bash
   brew install livekit   # or download a release: https://github.com/livekit/livekit/releases
   livekit-server --dev
   ```

   The development server's local-only `devkey` and `secret` credentials match the `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `LIVEKIT_URL` defaults in `.env.example`.

2. In the repository root's ignored `.env`, set these optional voice credentials:

   ```dotenv
   DEEPGRAM_API_KEY=<redacted>
   CARTESIA_API_KEY=<redacted>
   LIVEKIT_API_KEY=devkey
   LIVEKIT_API_SECRET=secret
   LIVEKIT_URL=ws://localhost:7880
   ```

3. From the repository root, start the LiveKit variant:

   ```bash
   bunx nx dev-livekit demo
   ```

   Run this variant through Nx so its build dependencies run first. It starts the Bun Engine host, the LiveKit voice-agent worker, and Vite in `livekit` mode.

## Things to type or say

- "Clear all this — just show me today"
- "What's my morning look like? I need to be at the design review by 10"
- "Actually skip the gym, add coffee with Sam at 9"
- "Start a journal entry about today's plan and jot down the key points"

## How voice works

The browser holds the OpenAI realtime session directly, authenticated by a short-lived token minted by `/api/realtime-token`. The model has one write path: an `update_ui` tool call carrying a plain-text intent, which follows the same path as typed input. The Engine plans against the app's own state, never the model's beliefs about the screen. The model receives the tool result only after rendering settles, so it does not narrate a change before it appears. See [`docs/realtime-voice-architecture.md`](../../docs/realtime-voice-architecture.md) for the full design.

## Debug overlays

Append `?debug` to the URL, for example `http://localhost:3000/?debug`, to show the grid and tiling overlay plus Instance ID and size labels for every Vessel. The overlay is off by default.

If the demo's motion looks disabled, check macOS **Reduce Motion** (System Settings → Accessibility → Display). The demo honors `prefers-reduced-motion`.

## Troubleshooting and shutdown

- **The browser shows `connected`, but an intent returns an Engine error:** confirm that `.env` contains a valid `GOOGLE_API_KEY` or fallback `GEMINI_API_KEY`. The WebSocket connection can succeed even when the Gemini credential required to process requests is missing.
- **Port 3000 or 3001 is already in use:** stop the other process, then rerun `bunx nx dev demo`.
- **Weather shows fixture data:** the demo could not reach Open-Meteo, so it silently uses canned values.
- **Map tiles are blank:** confirm network access to `tiles.openfreemap.org`.
- **OpenAI voice cannot start:** confirm that the optional OpenAI credential is present in `.env`, then allow microphone access for the site and retry the orb.
- **LiveKit reports missing environment variables:** provide the optional `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, and LiveKit settings described above.
- **LiveKit reports `ECONNREFUSED ws://localhost:7880`:** start `livekit-server --dev` before starting the LiveKit variant.
- **A LiveKit token configuration fails:** `LIVEKIT_TOKEN_TTL` must be a bare number of seconds or an integer followed by `s`, `m`, `h`, or `d`; its default is `15m`.

Press `Ctrl-C` once in the startup terminal to stop both demo processes. Delete `.env` afterward only if you also want to remove the local credentials; otherwise keep the ignored file for the next run.

## Further reading

- [`packages/realtime-livekit-agent/README.md`](../../packages/realtime-livekit-agent/README.md) — voice-agent worker internals
- [`docs/realtime-voice-architecture.md`](../../docs/realtime-voice-architecture.md) — OpenAI realtime voice architecture
