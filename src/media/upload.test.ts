import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import test from "node:test";
import type { MediaConfig, MediaManifest } from "./types";
import { processMedia } from "./process";
import { type ObjectUploader, uploadMedia } from "./upload";

function configFor(): MediaConfig {
  return {
    rawDir: "media/raw",
    processedDir: "media/processed",
    productsDir: "media/processed/products",
    manifestJsonPath: "manifest.json",
    manifestCsvPath: "manifest.csv",
    stateDir: ".media-state",
    targetWidths: [480, 768, 1024],
    defaultNumericSeparators: ["__"],
    preCodes: {},
  };
}

async function jpeg(width: number, height: number, color: string): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

test("upload dry-run plans changed variants without writing objects or queue", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-upload-dry-"));
  try {
    await fs.mkdir(path.join(root, "media/raw/CFV"), { recursive: true });
    await fs.writeFile(path.join(root, "media/raw/CFV/A__1.jpg"), await jpeg(800, 800, "#111"));
    await processMedia({ cwd: root, baseUrl: "https://img.example.test", config: configFor(), dryRun: false });

    const result = await uploadMedia({
      cwd: root,
      baseUrl: "https://img.example.test",
      config: configFor(),
      fetchRemoteManifest: async () => null,
    });

    assert.equal(result.mode, "dry-run");
    assert.equal(result.queued, 2);
    await assert.rejects(fs.access(path.join(root, ".media-state/r2-upload-queue.json")), /ENOENT/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("upload confirm uploads variants first and manifests last", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-upload-confirm-"));
  try {
    await fs.mkdir(path.join(root, "media/raw/CFV"), { recursive: true });
    await fs.writeFile(path.join(root, "media/raw/CFV/A__1.jpg"), await jpeg(800, 800, "#111"));
    await processMedia({ cwd: root, baseUrl: "https://img.example.test", config: configFor(), dryRun: false });

    const calls: string[] = [];
    const uploader: ObjectUploader = {
      async putObject(object) {
        calls.push(object.objectKey);
        return { eTag: `etag-${calls.length}` };
      },
    };
    const result = await uploadMedia({
      cwd: root,
      baseUrl: "https://img.example.test",
      config: configFor(),
      confirm: true,
      uploader,
      fetchRemoteManifest: async () => null,
    });

    assert.equal(result.uploaded, 2);
    assert.deepEqual(calls.slice(-2), ["manifest.csv", "manifest.json"]);
    const queue = JSON.parse(await fs.readFile(path.join(root, ".media-state/r2-upload-queue.json"), "utf8")) as { items: Array<{ status: string }> };
    assert.equal(queue.items.length, 2);
    assert.ok(queue.items.every((item) => item.status === "uploaded"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("partial upload publishes selected local assets while preserving remote unselected assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-upload-partial-"));
  try {
    await fs.mkdir(path.join(root, "media/raw/CFV"), { recursive: true });
    await fs.mkdir(path.join(root, "media/raw/UFI"), { recursive: true });
    await fs.writeFile(path.join(root, "media/raw/CFV/A__1.jpg"), await jpeg(800, 800, "#111"));
    await fs.writeFile(path.join(root, "media/raw/UFI/B__1.jpg"), await jpeg(800, 800, "#222"));
    await processMedia({ cwd: root, baseUrl: "https://img.example.test", config: configFor(), dryRun: false });
    const local = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")) as MediaManifest;
    const remoteUfi = local.assets.find((asset) => asset.pre_code === "UFI")!;
    const remoteManifest: MediaManifest = {
      ...local,
      assets: [{ ...remoteUfi, checksum: "remote-old" }],
    };

    let published: MediaManifest | null = null;
    const uploader: ObjectUploader = {
      async putObject(object) {
        if (object.objectKey === "manifest.json") {
          published = JSON.parse(object.body.toString("utf8")) as MediaManifest;
        }
        return {};
      },
    };

    const result = await uploadMedia({
      cwd: root,
      baseUrl: "https://img.example.test",
      config: configFor(),
      pre: "CFV",
      confirm: true,
      uploader,
      fetchRemoteManifest: async () => remoteManifest,
    });

    assert.equal(result.partialPublish, true);
    const publishedManifest: MediaManifest = published ?? assert.fail("manifest.json was not published");
    assert.equal(publishedManifest.assets.find((asset) => asset.pre_code === "UFI")?.checksum, "remote-old");
    assert.equal(publishedManifest.assets.find((asset) => asset.pre_code === "CFV")?.checksum, local.assets.find((asset) => asset.pre_code === "CFV")?.checksum);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
