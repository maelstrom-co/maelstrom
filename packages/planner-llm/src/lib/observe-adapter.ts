import {
  normalizeLlmUsage,
  type ReportedLlmUsage,
} from '@maelstrom-co/telemetry/usage';
import type { AdapterYieldChunk, AnyTextAdapter } from '@tanstack/ai';

/** Observes usage and aborts before core filtering or finalization can discard them. @internal */
export function observeAdapter(
  adapter: AnyTextAdapter,
  record: (usage: ReportedLlmUsage) => void,
  onAbort: () => void,
): AnyTextAdapter {
  // A child target permits method wrapping even when the adapter is frozen.
  const observed: AnyTextAdapter = Object.create(adapter);
  return new Proxy(observed, {
    get(_target, property) {
      const value: unknown = Reflect.get(adapter, property, adapter);
      if (typeof value !== 'function') return value;
      if (property === 'chatStream' || property === 'structuredOutputStream')
        return (...args: unknown[]) =>
          observeStream(() => value.apply(adapter, args), record, onAbort);
      if (property === 'structuredOutput')
        return async (...args: unknown[]) => {
          try {
            const result = await value.apply(adapter, args);
            const usage = normalizeLlmUsage(result?.usage);
            if (usage) record(usage);
            return result;
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError')
              onAbort();
            throw error;
          }
        };
      return value.bind(adapter);
    },
  });
}

async function* observeStream(
  create: () => AsyncIterable<AdapterYieldChunk>,
  record: (usage: ReportedLlmUsage) => void,
  onAbort: () => void,
): AsyncGenerator<AdapterYieldChunk> {
  let recorded = false;
  try {
    for await (const chunk of create()) {
      const metadata = chunk.metadata?.tanstack;
      if (
        chunk.type === 'RUN_ERROR' &&
        (chunk.code === 'aborted' ||
          (metadata &&
            'stopReason' in metadata &&
            metadata.stopReason === 'aborted'))
      )
        onAbort();
      if (
        !recorded &&
        (chunk.type === 'RUN_FINISHED' || chunk.type === 'RUN_ERROR')
      ) {
        const usage = normalizeLlmUsage(
          chunk.usage,
          chunk.metadata?.tanstack?.usage,
        );
        if (usage) {
          record(usage);
          recorded = true;
        }
      }
      yield chunk;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') onAbort();
    throw error;
  }
}
