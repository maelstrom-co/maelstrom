/** Runtime surface loaded only for enabled local greeting interruption. */
export type GreetingInterruptionRuntime =
  typeof import('@maelstrom-co/realtime-vad');

/** Package-private importer seam used by enabled connection preparation. */
export type GreetingInterruptionRuntimeImporter =
  () => Promise<GreetingInterruptionRuntime>;

const importRuntime: GreetingInterruptionRuntimeImporter = () =>
  import('@maelstrom-co/realtime-vad');
let currentImporter = importRuntime;

/**
 * Loads the browser VAD and pre-roll runtime behind the experimental opt-in.
 * Omitted and explicitly disabled adapters never call this function.
 */
export function loadGreetingInterruptionRuntime(
  importer: GreetingInterruptionRuntimeImporter = currentImporter,
): Promise<GreetingInterruptionRuntime> {
  return importer();
}

/** Installs a scoped package-private runtime importer for adapter tests. */
export function setGreetingInterruptionRuntimeImporterForTests(
  importer: GreetingInterruptionRuntimeImporter,
): () => void {
  const previous = currentImporter;
  currentImporter = importer;
  return () => {
    currentImporter = previous;
  };
}
