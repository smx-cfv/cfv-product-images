import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { MediaConfig } from "./types";
import { inspectMediaInput } from "./preflight";

const config: MediaConfig = {
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

test("preflight counts valid images and reports unsupported files as warnings", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-preflight-valid-"));
  try {
    await fs.mkdir(path.join(root, "media/raw/CFV"), { recursive: true });
    await fs.writeFile(path.join(root, "media/raw/CFV/A__1.jpg"), "image");
    await fs.writeFile(path.join(root, "media/raw/CFV/note.txt"), "note");
    await fs.writeFile(path.join(root, "media/raw/.DS_Store"), "ignored");

    const result = await inspectMediaInput({ cwd: root, config });

    assert.equal(result.imageCount, 1);
    assert.deepEqual(result.preCodes, ["CFV"]);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]?.path, "media/raw/CFV/note.txt");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("preflight rejects supported images outside the expected folder depth", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-preflight-layout-"));
  try {
    await fs.mkdir(path.join(root, "media/raw/CFV/nested"), { recursive: true });
    await fs.writeFile(path.join(root, "media/raw/CFV/nested/A__1.jpg"), "image");

    const result = await inspectMediaInput({ cwd: root, config });

    assert.equal(result.imageCount, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]?.message ?? "", /direttamente/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("preflight rejects files that would generate the same object keys", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-preflight-collision-"));
  try {
    await fs.mkdir(path.join(root, "media/raw/CFV"), { recursive: true });
    await fs.writeFile(path.join(root, "media/raw/CFV/A__1.jpg"), "image");
    await fs.writeFile(path.join(root, "media/raw/CFV/A__1.png"), "image");

    const result = await inspectMediaInput({ cwd: root, config });

    assert.equal(result.imageCount, 2);
    assert.equal(result.errors.length, 2);
    assert.ok(result.errors.every((issue) => issue.message.includes("Collisione")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
