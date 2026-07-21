import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const vadEntry = fileURLToPath(await import.meta.resolve('@ricky0123/vad-web'));
const vadDist = dirname(vadEntry);
const ortEntry = fileURLToPath(
  await import.meta.resolve('onnxruntime-web/wasm'),
);
const ortDist = dirname(ortEntry);
const outputDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'vad-web',
);

await mkdir(outputDir, { recursive: true });

const vadFiles = await readdir(vadDist);
const ortFiles = await readdir(ortDist);
const assets = [
  ...vadFiles
    .filter(
      (fileName) =>
        fileName === 'vad.worklet.bundle.min.js' || fileName.endsWith('.onnx'),
    )
    .map((fileName) => [vadDist, fileName] as const),
  ...ortFiles
    .filter(
      (fileName) => fileName.endsWith('.mjs') || fileName.endsWith('.wasm'),
    )
    .map((fileName) => [ortDist, fileName] as const),
];

await Promise.all(
  assets.map(([sourceDir, fileName]) =>
    cp(join(sourceDir, fileName), join(outputDir, fileName)),
  ),
);

console.log(`Copied ${assets.length} browser VAD assets to ${outputDir}`);
