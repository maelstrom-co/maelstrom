// Install the same native-probe guard as the normal runner before importing FFI.
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

const { runTriggerVoiceAgent } = await import(
  '@maelstrom-co/realtime-livekit-agent'
);
runTriggerVoiceAgent();
