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

test("full upload preserves remote-only assets in json and csv manifests", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-upload-additive-"));
  try {
    await fs.mkdir(path.join(root, "media/raw/CFV"), { recursive: true });
    await fs.writeFile(path.join(root, "media/raw/CFV/A__1.jpg"), await jpeg(800, 800, "#111"));
    await processMedia({ cwd: root, baseUrl: "https://img.example.test", config: configFor(), dryRun: false });
    const local = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")) as MediaManifest;
    const localAsset = local.assets[0]!;
    const remoteOnly = {
      ...localAsset,
      pre_code: "UFI",
      raw_code: "REMOTE",
      product_code: "REMOTE",
      source_key: "media/raw/UFI/REMOTE__1.jpg",
      checksum: "remote-checksum",
      variants: localAsset.variants.map((variant) => ({
        ...variant,
        object_key: variant.object_key.replace("CFV__A", "UFI__REMOTE"),
        slug: variant.slug.replace("CFV__A", "UFI__REMOTE"),
      })),
    };
    const remoteManifest: MediaManifest = {
      ...local,
      assets: [remoteOnly],
    };

    let publishedJson: MediaManifest | null = null;
    let publishedCsv = "";
    const uploader: ObjectUploader = {
      async putObject(object) {
        if (object.objectKey === "manifest.json") {
          publishedJson = JSON.parse(object.body.toString("utf8")) as MediaManifest;
        }
        if (object.objectKey === "manifest.csv") {
          publishedCsv = object.body.toString("utf8");
        }
        return {};
      },
    };

    const result = await uploadMedia({
      cwd: root,
      baseUrl: "https://img.example.test",
      config: configFor(),
      confirm: true,
      uploader,
      fetchRemoteManifest: async () => remoteManifest,
    });

    const manifest: MediaManifest = publishedJson ?? assert.fail("manifest.json was not published");
    assert.equal(result.preservedRemoteAssets, 1);
    assert.equal(manifest.assets.length, 2);
    assert.ok(manifest.assets.some((asset) => asset.pre_code === "UFI"));
    assert.match(publishedCsv, /UFI,REMOTE/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reports upload progress and avoids republishing an unchanged manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-upload-progress-"));
  try {
    await fs.mkdir(path.join(root, "media/raw/CFV"), { recursive: true });
    await fs.writeFile(path.join(root, "media/raw/CFV/A__1.jpg"), await jpeg(800, 800, "#111"));
    await processMedia({ cwd: root, baseUrl: "https://img.example.test", config: configFor(), dryRun: false });
    const local = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")) as MediaManifest;
    const progress: Array<{ completed: number; total: number }> = [];
    const uploader: ObjectUploader = {
      async putObject() {
        return {};
      },
    };

    const first = await uploadMedia({
      cwd: root,
      baseUrl: "https://img.example.test",
      config: configFor(),
      confirm: true,
      concurrency: 1,
      uploader,
      fetchRemoteManifest: async () => null,
      onProgress: ({ completed, total }) => progress.push({ completed, total }),
    });

    assert.deepEqual(progress, [
      { completed: 1, total: 2 },
      { completed: 2, total: 2 },
    ]);
    assert.equal(first.manifestChanged, true);

    let unexpectedUploads = 0;
    const second = await uploadMedia({
      cwd: root,
      baseUrl: "https://img.example.test",
      config: configFor(),
      confirm: true,
      uploader: {
        async putObject() {
          unexpectedUploads += 1;
          return {};
        },
      },
      fetchRemoteManifest: async () => local,
    });

    assert.equal(second.manifestChanged, false);
    assert.equal(second.manifestPublished, false);
    assert.equal(unexpectedUploads, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("concurrent uploads record every uploaded variant in the queue", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-upload-concurrent-"));
  try {
    await fs.mkdir(path.join(root, "media/raw/CFV"), { recursive: true });
    for (let index = 0; index < 12; index += 1) {
      await fs.writeFile(path.join(root, `media/raw/CFV/A${index}__1.jpg`), await jpeg(800, 800, `#${(index + 1).toString(16).repeat(3)}`));
    }
    await processMedia({ cwd: root, baseUrl: "https://img.example.test", config: configFor(), dryRun: false });

    const uploader: ObjectUploader = {
      async putObject() {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
        return {};
      },
    };
    // Windows rejects overlapping renames onto the same file with EPERM: track overlap here.
    const originalRename = fs.rename;
    let activeQueueRenames = 0;
    let maxActiveQueueRenames = 0;
    fs.rename = async (from, to) => {
      const isQueue = String(to).endsWith("r2-upload-queue.json");
      if (isQueue) maxActiveQueueRenames = Math.max(maxActiveQueueRenames, ++activeQueueRenames);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return await originalRename(from, to);
      } finally {
        if (isQueue) activeQueueRenames -= 1;
      }
    };
    let result: Awaited<ReturnType<typeof uploadMedia>>;
    try {
      result = await uploadMedia({
        cwd: root,
        baseUrl: "https://img.example.test",
        config: configFor(),
        confirm: true,
        concurrency: 6,
        uploader,
        fetchRemoteManifest: async () => null,
      });
    } finally {
      fs.rename = originalRename;
    }

    assert.equal(result.uploaded, 24);
    assert.equal(maxActiveQueueRenames, 1);
    const stateFiles = await fs.readdir(path.join(root, ".media-state"));
    assert.ok(stateFiles.every((name) => !name.includes(".tmp-")), `leftover temp files: ${stateFiles.join(", ")}`);
    const queue = JSON.parse(await fs.readFile(path.join(root, ".media-state/r2-upload-queue.json"), "utf8")) as { items: Array<{ status: string }> };
    assert.equal(queue.items.length, 24);
    assert.ok(queue.items.every((item) => item.status === "uploaded"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
