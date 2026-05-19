// Always a resolved promise — failures are encoded in the discriminator,
// never thrown — so the hook can branch synchronously after `.then()` without
// a surrounding try/catch. `skipped` is for non-browser hosts where the
// hook's `useEffect` will not run; reaching it inside a running effect is a
// misconfigured probe and surfaces via `warnOnce` in dev.
export type VoiceProbeResult =
  | { status: 'ready'; module: typeof import('@maelstrom-co/voice') }
  | { status: 'failed'; error: unknown }
  | { status: 'skipped' };

// Distinguishes "peer truly absent" from "peer present but unusable" so the
// original error survives on `cause` instead of collapsing to a generic
// `DEPENDENCY_MISSING`. Recognises Node/Bun's `ERR_MODULE_NOT_FOUND` plus
// the bundler-runtime message shapes from Vite, webpack, Rollup, and
// esbuild, which all throw plain `Error`s rather than carrying a code.
export function isMissingModuleError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (
    'code' in err &&
    (err as { code?: unknown }).code === 'ERR_MODULE_NOT_FOUND'
  ) {
    return true;
  }
  return /Cannot find (module|package)|Failed to (resolve module|fetch dynamically imported module)/.test(
    err.message,
  );
}
