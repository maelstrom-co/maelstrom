/** Silero model variants supported by the browser VAD asset bundle. */
export type BrowserVadModel = 'legacy' | 'v5';

/** Provider model and worklet files copied by the VAD asset installer. */
export const vadAssetNames = [
  'silero_vad_legacy.onnx',
  'silero_vad_v5.onnx',
  'vad.worklet.bundle.min.js',
] as const;

/** ONNX Runtime Web files copied by the VAD asset installer. */
export const onnxRuntimeAssetNames = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jspi.mjs',
  'ort-wasm-simd-threaded.jspi.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
] as const;

/** Complete sorted asset manifest copied by the VAD asset installer. */
export const expectedAssetNames = [
  ...vadAssetNames,
  ...onnxRuntimeAssetNames,
].sort();

/**
 * Returns the minimal browser asset set for a specific Silero model.
 *
 * @param model - Silero model variant selected by the browser configuration.
 * @returns The standard ONNX runtime, selected model, and VAD worklet files.
 */
export function browserVadAssetNamesForModel(model: BrowserVadModel) {
  return [
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
    model === 'v5' ? 'silero_vad_v5.onnx' : 'silero_vad_legacy.onnx',
    'vad.worklet.bundle.min.js',
  ] as const;
}
