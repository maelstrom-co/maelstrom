# Maelstrom Demo

The Maelstrom demo is a day-planner UI whose Chart is arranged by an LLM. This walkthrough starts the typed demo from a cold clone. Voice is optional and uses the same Engine path after it turns speech into an intent.

<!-- screenshot: busy board mid-rearrange, orb active -->

## Prerequisites

Before starting, install or confirm the following:

- Git
- the current stable version of Bun
- Node.js 24, as specified by the repository's `.nvmrc` and CI configuration
- free local ports 3000 and 3001
- outbound network access to OpenAI; weather and map data also use optional external services
- an OpenAI API key for the baseline typed flow, supplied through `.env` or the browser prompt

The baseline does not require microphone permission, a LiveKit server, Deepgram, or Cartesia.

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

Choose where the demo keeps your OpenAI key:

- Set `OPENAI_API_KEY` in `.env` to keep the key on the local server. The server uses it for text planning, short-lived realtime voice credentials, and the fixed greeting.
- Leave `OPENAI_API_KEY` empty to enter the key in the browser drawer. The key stays in memory until you reload or close the page. Voice calls OpenAI directly, while the local WebSocket server keeps the key and its text-planning Engine in memory for that connection.

```dotenv
# Optional. Leave empty to use the browser key drawer.
OPENAI_API_KEY=<redacted>
# Optional; defaults to gpt-6-luna.
ENGINE_MODEL=
```

The server-owned greeting route is development-only: bodyless same-origin POST, exact fixed payload, process-local cache, and at most three upstream attempts in a 60-second window. The budget resets after the window elapses and after a validated response is cached; it is not a general speech API or production distributed abuse protection.

The UI shows a compact disclosure next to the voice orb: “AI-generated voice”. Browser-key mode calls OpenAI speech and client-secret endpoints directly from the browser; the key never touches browser storage.

The repository ignores `.env`. Never commit it or paste its contents into logs, issues, or other shared material. Keep examples empty or redacted as shown above.

From the repository root, start both baseline processes with the canonical command:

```bash
bunx nx dev demo
```

The command builds the required workspace packages, then starts:

The mint route this path uses (`src/routes/api/realtime-token.ts`) is
development-only, for the same reason the LiveKit one below is: it does not
authenticate the caller, and it forwards the request body to the minter, so the
caller chooses the model. Replace it with the server-owned route from the
[OpenAI Realtime guide](https://docs.maelstrom-ai.co/guides/voice/openai-realtime/)
before any deployment. The fixed greeting TTS route
(`src/routes/api/demo-greeting-tts.ts`) is likewise development-only and must not
be treated as production abuse protection.

**Greeting TTS troubleshooting.** If the caption appears but there is no audio,
confirm the browser allowed microphone/autoplay after the orb click, check that
`POST /api/demo-greeting-tts` returned `audio/wav`, and verify `OPENAI_API_KEY`
can call `/v1/audio/speech`. A second greeting after reconnect within the same
session is a bug; a second upstream OpenAI TTS call after a successful cache fill
in the same server process is also unexpected.

The `nx` commands in this README run from the repository root. Commands shown
as `bun run ...` under the LiveKit section run from `apps/demo/`.

The terminal is ready when the Vite output shows `http://localhost:3000` and the Engine host output shows `ws://localhost:3001/ws`. Neither process should exit.

This is the repository's development-only LiveKit checkpoint. It exercises the
browser adapter and local worker, but its mint route is not a production token
boundary. For deployment, follow the
[LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/)
after validating the local path.

1. Install and run a LiveKit server in dev mode:

   ```bash
   brew install livekit   # or download a release: https://github.com/livekit/livekit/releases
   livekit-server --dev
   ```

## Optional: GPT-Live with a local server key

Fresh visits select **GPT-Live** by default. You can change the voice provider
in the selector before starting voice.
When you enter an OpenAI key in the browser drawer, Live exchanges the session
directly with OpenAI. The Engine still receives that key separately for planning.

To use a server-held OpenAI key for Live instead, configure the repository's
ignored `.env` file:

```dotenv
OPENAI_API_KEY=<redacted>
DEMO_LOCAL_SERVER_KEY=1
DEMO_LOCAL_PASSWORD=<a-separate-unique-password-of-at-least-24-characters>
```

Restart `bunx nx dev demo`, open `http://127.0.0.1:3000`, and sign in to the
browser's HTTP authentication prompt. Use `maelstrom` as the username and
`DEMO_LOCAL_PASSWORD` as the password. This password is separate from the OpenAI
key. Select **GPT-Live** and start voice. A successful exchange returns HTTP 201
from `/api/live-session`.

This mode serves the Live exchange only through the authenticated Vite development
middleware. It checks the listener and connection addresses and refuses a
non-loopback bind. HTTP authentication also prevents a local forwarding proxy
from granting access through forged request headers alone. The standalone Start
handler and hosted mode reject this server-key route. An authenticated remote
Start deployment needs its own host integration; forwarding the development
server is not that integration.

If local mode is disabled, the password is missing, or authentication fails,
repair the configuration before reconnecting. Live does not automatically start
another paid session.

## Optional: OpenAI realtime voice

OpenAI realtime voice is optional. The typed baseline works without voice and does not request microphone permission unless you use the voice orb.

To enable this track, add the following to `.env` from the repository root:

```dotenv
OPENAI_API_KEY=<redacted>
# Select Realtime on fresh visits instead of the GPT-Live default.
VITE_VOICE_PROVIDER=realtime
# Optional model override; omit it to use gpt-realtime-2.1.
OPENAI_REALTIME_MODEL=
```

Keep the API key only in the ignored `.env` file. The demo's server-side minter uses it to create a short-lived browser credential; do not expose the API key in browser code or shared output.

Start the demo with the baseline command above. Confirm that the selector shows
**OpenAI Realtime**, then use the voice orb and allow microphone access. You can
also select **OpenAI Realtime** manually instead of setting `VITE_VOICE_PROVIDER`.
This Realtime setup does not enable the authenticated local GPT-Live exchange;
follow [the local GPT-Live setup](#optional-gpt-live-with-a-local-server-key) to use
that provider with a server-held key.

## Optional: LiveKit cascade voice

The LiveKit cascade is also optional. It requires a local LiveKit server plus real Deepgram and Cartesia credentials.

1. Install and run a LiveKit server in development mode:

   ```bash
   brew install livekit   # or download a release: https://github.com/livekit/livekit/releases
   livekit-server --dev
   ```

   The development server's local-only `devkey` and `secret` credentials match the `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `LIVEKIT_URL` defaults in `.env.example`.

2. In the repository root's ignored `.env`, set these optional voice-provider credentials:

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

   The build dependencies also run `maelstrom-vad-assets` from
   `@maelstrom-co/realtime-vad`. This installs the package-matched VAD and ONNX
   Runtime assets into the ignored `public/vad-web/` directory before Vite
   starts. The default `/vad-web/` URL does not create these assets at runtime.

## Things to type or say

- "Clear all this — just show me today"
- "What's my morning look like? I need to be at the design review by 10"
- "Actually skip the gym, add coffee with Sam at 9"
- "Start a journal entry about today's plan and jot down the key points"

## How voice works

The browser holds the OpenAI realtime session directly, authenticated by a short-lived token minted by `/api/realtime-token`. The model has one write path: an `update_ui` tool call carrying a plain-text intent, which follows the same path as typed input. The Engine plans against the app's own state, never the model's beliefs about the screen. The model receives the tool result only after rendering settles, so it does not narrate a change before it appears. See [`docs/realtime-voice-architecture.md`](../../docs/realtime-voice-architecture.md) for the full design.

## Debug overlays

Append `?debug` to the URL, for example `http://localhost:3000/?debug`, to show the grid and tiling overlay plus Instance ID and size labels for every Vessel. The overlay is off by default.

**Recording tip:** macOS's Reduce Motion setting (System Settings → Accessibility → Display) disables the demo's choreography through `prefers-reduced-motion`.

## Troubleshooting and shutdown

- **The browser shows `connected`, but an intent returns an Engine error:** confirm that `.env` contains a valid `OPENAI_API_KEY`. The WebSocket connection can succeed even when the OpenAI credential required to process requests is missing.
- **Port 3000 or 3001 is occupied:** stop the process using that port, then run the canonical startup command again. Do not work around the conflict by changing the documented ports or command.
- **Weather shows fixture data:** the demo could not reach Open-Meteo, so it silently uses canned values.
- **Map tiles are blank:** confirm network access to `tiles.openfreemap.org`.
- **OpenAI voice cannot start:** confirm that the optional OpenAI credential is present in `.env`, then allow microphone access for the site and retry the orb.
- **LiveKit reports missing environment variables:** provide the optional `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, and LiveKit settings described above.
- **LiveKit reports `ECONNREFUSED ws://localhost:7880`:** start `livekit-server --dev` before starting the LiveKit variant.
- **A LiveKit token configuration fails:** `LIVEKIT_TOKEN_TTL` must be a bare number of seconds or an integer followed by `s`, `m`, `h`, or `d`; its default is `15m`.
- **The LiveKit agent rejects its flush timeout:** `MAELSTROM_STT_FLUSH_TIMEOUT_MS` must be a positive number; its default is `2000`.

Press `Ctrl-C` once in the startup terminal to stop both baseline processes. Delete `.env` afterward only if you also want to remove the local credentials; otherwise keep the ignored file for the next run.

## Further reading

- [LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/) — browser integration first, then the production token and worker checkpoint
- [`packages/realtime-livekit-agent/README.md`](../../packages/realtime-livekit-agent/README.md) — voice agent worker internals
- [`packages/realtime-livekit/README.md`](../../packages/realtime-livekit/README.md) — adapter VAD configuration and asset deployment
- [`packages/react-realtime/README.md`](../../packages/react-realtime/README.md) — `useVoice()` turn-mode state
- [`docs/realtime-voice-architecture.md`](../../docs/realtime-voice-architecture.md) — realtime voice architecture
