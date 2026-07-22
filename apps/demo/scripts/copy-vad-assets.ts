import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface CopyVadAssetsOptions {
  readonly vadDist: string;
  readonly ortDist: string;
  readonly outputDir: string;
}

/**
 * Replaces the output directory with assets discovered in the current
 * packages. The directory is deleted before discovery and copying, so a
 * successful run cannot retain files from an older package version. File
 * system failures reject and remain uncaught by the CLI entry point.
 *
 * @returns The number of copied assets.
 */
export async function copyVadAssets({
  vadDist,
  ortDist,
  outputDir,
}: CopyVadAssetsOptions): Promise<number> {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const vadFiles = await readdir(vadDist);
  const ortFiles = await readdir(ortDist);
  const assets = [
    ...vadFiles
      .filter(
        (fileName) =>
          fileName === "vad.worklet.bundle.min.js" ||
          fileName.endsWith(".onnx"),
      )
      .map((fileName) => [vadDist, fileName] as const),
    ...ortFiles
      .filter(
        (fileName) => fileName.endsWith(".mjs") || fileName.endsWith(".wasm"),
      )
      .map((fileName) => [ortDist, fileName] as const),
  ];

  await Promise.all(
    assets.map(([sourceDir, fileName]) =>
      cp(join(sourceDir, fileName), join(outputDir, fileName)),
    ),
  );

  return assets.length;
}

if (import.meta.main) {
  const vadEntry = fileURLToPath(
    await import.meta.resolve("@ricky0123/vad-web"),
  );
  const ortEntry = fileURLToPath(
    await import.meta.resolve("onnxruntime-web/wasm"),
  );
  const outputDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "public",
    "vad-web",
  );
  const copiedAssetCount = await copyVadAssets({
    vadDist: dirname(vadEntry),
    ortDist: dirname(ortEntry),
    outputDir,
  });

  console.log(`Copied ${copiedAssetCount} browser VAD assets to ${outputDir}`);
}
