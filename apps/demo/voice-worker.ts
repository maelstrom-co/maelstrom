// Boots the LiveKit voice agent as a standalone worker process alongside the
// app (see the `dev-agent` script). Kept as a thin entry so `--env-file-if-exists` loads
// the LiveKit/Deepgram/Cartesia secrets before the worker registers.

// Optional native/platform bindings (LiveKit FFI prebuilds, Silero VAD) probe-
// load and throw MODULE_NOT_FOUND on unsupported platforms — that's noise, not a
// real failure. Suppress ONLY those (matched by module code + name), and re-throw
// everything else so a genuine missing dependency or startup crash stays visible.
//
// The guard MUST be registered before the agent package is imported: ESM
// evaluates a module's static imports (including the @livekit/* graph) before
// any other statement, so the agent is pulled in via `await import()` below —
// after this handler is live — rather than a static import that would run the
// native probe first and escape the guard.
const OPTIONAL_NATIVE_MODULES = [
  '@livekit/rtc-ffi-bindings',
  '@livekit/agents-plugin-silero',
];
process.on('uncaughtException', (err) => {
  const code = (err as NodeJS.ErrnoException).code;
  const message = err instanceof Error ? err.message : String(err);
  if (
    code === 'MODULE_NOT_FOUND' &&
    OPTIONAL_NATIVE_MODULES.some((name) => message.includes(name))
  ) {
    console.debug(
      '[voice-agent] suppressed optional native module error:',
      message,
    );
    return;
  }
  throw err;
});

const { runVoiceAgent } = await import('@maelstrom-co/realtime-livekit-agent');

runVoiceAgent();
