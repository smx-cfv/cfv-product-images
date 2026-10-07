import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { atomicWriteFile, createSerialFileWriter, mapWithConcurrency } from "./utils";

test("mapWithConcurrency stops starting items after a failure and waits for in-flight ones", async () => {
  const started: number[] = [];
  const finished: number[] = [];
  await assert.rejects(mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
    started.push(item);
    if (item === 1) throw new Error("boom");
    await delay(20);
    finished.push(item);
    return item;
  }), /boom/);

  assert.deepEqual(started, [0, 1, 2]);
  assert.deepEqual(finished.sort(), [0, 2]);
});

test("serial file writer ends with the latest content and leaves no temp files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-serial-writer-"));
  try {
    const filePath = path.join(root, "state/queue.json");
    const write = createSerialFileWriter(filePath);
    await Promise.all(Array.from({ length: 50 }, async (_, index) => {
      await delay(Math.random() * 5);
      await write(`${index}`);
    }));
    await write("final");

    assert.equal(await fs.readFile(filePath, "utf8"), "final");
    assert.deepEqual(await fs.readdir(path.dirname(filePath)), ["queue.json"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("atomic write retries a rename that Windows rejects with EPERM while the file is held", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cfv-atomic-retry-"));
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const originalRename = fs.rename;
  let attempts = 0;
  Object.defineProperty(process, "platform", { value: "win32" });
  fs.rename = async (from, to) => {
    attempts += 1;
    if (attempts <= 2) throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
    return originalRename(from, to);
  };
  try {
    const filePath = path.join(root, "queue.json");
    await atomicWriteFile(filePath, "content");

    assert.equal(attempts, 3);
    assert.equal(await fs.readFile(filePath, "utf8"), "content");
    assert.deepEqual(await fs.readdir(root), ["queue.json"]);
  } finally {
    fs.rename = originalRename;
    Object.defineProperty(process, "platform", originalPlatform);
    await fs.rm(root, { recursive: true, force: true });
  }
});
