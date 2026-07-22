import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { copyVadAssets } from "./copy-vad-assets.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("copyVadAssets", () => {
  test("replaces obsolete assets with only the currently discovered asset set", async () => {
    const root = await mkdtemp(join(tmpdir(), "maelstrom-vad-assets-"));
    tempDirectories.push(root);
    const vadDist = join(root, "vad-dist");
    const ortDist = join(root, "ort-dist");
    const outputDir = join(root, "public", "vad-web");
    await Promise.all([
      mkdir(vadDist, { recursive: true }),
      mkdir(ortDist, { recursive: true }),
      mkdir(outputDir, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(vadDist, "vad.worklet.bundle.min.js"), "worklet"),
      writeFile(join(vadDist, "current.onnx"), "model"),
      writeFile(join(vadDist, "not-an-asset.txt"), "ignored"),
      writeFile(join(ortDist, "current.mjs"), "module"),
      writeFile(join(ortDist, "current.wasm"), "wasm"),
      writeFile(join(ortDist, "not-an-asset.js"), "ignored"),
      writeFile(join(outputDir, "obsolete.onnx"), "old model"),
      writeFile(join(outputDir, "obsolete.mjs"), "old module"),
      writeFile(join(outputDir, "obsolete.wasm"), "old wasm"),
    ]);

    await copyVadAssets({ vadDist, ortDist, outputDir });

    expect((await readdir(outputDir)).sort()).toEqual([
      "current.mjs",
      "current.onnx",
      "current.wasm",
      "vad.worklet.bundle.min.js",
    ]);
  });
});
