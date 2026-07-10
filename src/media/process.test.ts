import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import test from "node:test";
import type { MediaConfig, MediaManifest } from "./types";
import { processMedia } from "./process";

function configFor(root: string): MediaConfig {
  return {
    rawDir: "media/raw",
    processedDir: "media/processed",
    productsDir: "media/processed/products",
    manifestJsonPath: "manifest.json",
    manifestCsvPath: "manifest.csv",
    stateDir: ".media-state",
    targetWidths: [480, 768, 1024],
    defaultNumericSeparators: ["__"],
    preCodes: {
      MANN: {
        numericSeparators: ["__", "-"],
        replacements: [
          { from: "_", to: "" },
          { from: ".", to: "/" },
        ],
      },
    },
  };
}

async function image(width: number, height: number, color: string, format: "jpeg" | "png" = "jpeg"): Promise<Buffer> {
  const instance = sharp({ create: { width, height, channels: 4, background: color } });
  return format === "png" ? instance.png().toBuffer() : instance.jpeg().toBuffer();
}

test("processes product images, writes manifests, and avoids upscaling", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-process-"));
  try {
    await fs.mkdir(path.join(root, "media/raw/CFV"), { recursive: true });
    await fs.mkdir(path.join(root, "media/raw/MANN"), { recursive: true });
    await fs.writeFile(path.join(root, "media/raw/CFV/50268A__1.jpg"), await image(1000, 1000, "#111"));
    await fs.writeFile(path.join(root, "media/raw/CFV/SMALL.png"), await image(320, 160, "#222", "png"));
    await fs.writeFile(path.join(root, "media/raw/MANN/HU713_1X-4.jpg"), await image(500, 500, "#333"));

    const result = await processMedia({
      cwd: root,
      baseUrl: "img.example.test",
      config: configFor(root),
      dryRun: false,
    });
    const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")) as MediaManifest;
    const csv = await fs.readFile(path.join(root, "manifest.csv"), "utf8");
    const cfv = manifest.assets.find((asset) => asset.raw_code === "50268A");
    const small = manifest.assets.find((asset) => asset.raw_code === "SMALL");
    const mann = manifest.assets.find((asset) => asset.pre_code === "MANN");

    assert.equal(result.assets, 3);
    assert.deepEqual(cfv?.variants.map((variant) => variant.width), [480, 768]);
    assert.deepEqual(small?.variants.map((variant) => variant.width), [320]);
    assert.equal(mann?.product_code, "HU7131X");
    assert.match(cfv?.variants[0]?.object_key ?? "", /^products\/CFV__50268A__1-480\.webp$/);
    assert.match(cfv?.variants[0]?.slug ?? "", /^https:\/\/img\.example\.test\/products\/CFV__50268A__1-480\.webp$/);
    assert.ok(csv.includes("slug_fallback"));
    assert.equal((await sharp(path.join(root, "media/processed/products/CFV__50268A__1-480.webp")).metadata()).format, "webp");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rerun reuses unchanged processed assets and regenerates only changed sources", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-process-rerun-"));
  try {
    await fs.mkdir(path.join(root, "media/raw/CFV"), { recursive: true });
    await fs.writeFile(path.join(root, "media/raw/CFV/A__1.jpg"), await image(800, 800, "#111"));
    await fs.writeFile(path.join(root, "media/raw/CFV/B__1.jpg"), await image(800, 800, "#222"));

    const first = await processMedia({ cwd: root, baseUrl: "https://img.example.test", config: configFor(root), dryRun: false });
    assert.equal(first.generatedAssets, 2);

    const second = await processMedia({ cwd: root, baseUrl: "https://img.example.test", config: configFor(root), dryRun: false });
    assert.equal(second.generatedAssets, 0);
    assert.equal(second.reusedAssets, 2);

    await fs.writeFile(path.join(root, "media/raw/CFV/A__1.jpg"), await image(800, 800, "#999"));
    const third = await processMedia({ cwd: root, baseUrl: "https://img.example.test", config: configFor(root), dryRun: false });
    assert.equal(third.generatedAssets, 1);
    assert.equal(third.reusedAssets, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("dry-run reads sources without writing processed output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-process-dry-"));
  try {
    await fs.mkdir(path.join(root, "media/raw/CFV"), { recursive: true });
    await fs.writeFile(path.join(root, "media/raw/CFV/A__1.jpg"), await image(800, 800, "#111"));

    const result = await processMedia({ cwd: root, baseUrl: "https://img.example.test", config: configFor(root), dryRun: true });
    assert.equal(result.mode, "dry-run");
    await assert.rejects(fs.access(path.join(root, "manifest.json")), /ENOENT/);
    await assert.rejects(fs.access(path.join(root, "media/processed/products")), /ENOENT/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
