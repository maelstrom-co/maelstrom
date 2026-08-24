import { browserVadAssetNamesForModel } from '@maelstrom-co/realtime-vad/asset-manifest';
import { HOSTED_VAD_MODEL } from './hosted-vad-model';

export { HOSTED_VAD_MODEL };
export const HOSTED_VAD_ASSET_NAMES =
  browserVadAssetNamesForModel(HOSTED_VAD_MODEL);

let preload: Promise<void> | undefined;

export function preloadHostedVadAssets(): Promise<void> {
  preload ??= Promise.all(
    HOSTED_VAD_ASSET_NAMES.map(async (name) => {
      const response = await fetch(`/vad-web/${name}`);
      if (!response.ok) throw new Error(`VAD asset failed: ${response.status}`);
      await response.arrayBuffer();
    }),
  )
    .then(() => undefined)
    .catch((error) => {
      preload = undefined;
      throw error;
    });
  return preload;
}
