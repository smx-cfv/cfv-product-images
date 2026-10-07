import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Missing public image domain/base URL.");
  return withTrailingSlash(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
}

export function publicUrlForObjectKey(baseUrl: string, objectKey: string): string {
  return new URL(objectKey, normalizeBaseUrl(baseUrl)).toString();
}

export function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

export async function atomicWriteFile(filePath: string, content: string | Buffer): Promise<void> {
  const target = path.resolve(filePath);
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, content);
  try {
    await renameWithRetry(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

const retryableRenameCodes = new Set(["EPERM", "EACCES", "EBUSY"]);

// On Windows, replacing a file fails with EPERM/EACCES/EBUSY while another handle
// (antivirus, search indexer, backup/sync tools) briefly holds it: retry like graceful-fs does.
async function renameWithRetry(from: string, to: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      const retryable = process.platform === "win32" && typeof code === "string" && retryableRenameCodes.has(code);
      if (!retryable || Date.now() >= deadline) throw error;
      await delay(Math.min(20 * attempt, 200));
    }
  }
}

// Stops starting new items after the first failure and waits for in-flight ones,
// so nothing keeps running (or writing) after the error is reported.
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failure: { error: unknown } | undefined;

  async function run(): Promise<void> {
    while (!failure && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await worker(items[index]!, index);
      } catch (error) {
        failure ??= { error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  if (failure) throw failure.error;
  return results;
}

// Serializes writes of a frequently updated file: at most one write in flight, and
// updates arriving meanwhile collapse into a single write of the latest content.
// The returned promise resolves once that content (or a newer one) is on disk.
export function createSerialFileWriter(filePath: string): (content: string) => Promise<void> {
  let latest: string | undefined;
  let writing: Promise<void> | undefined;

  return (content) => {
    latest = content;
    writing ??= (async () => {
      try {
        while (latest !== undefined) {
          const next = latest;
          latest = undefined;
          await atomicWriteFile(filePath, next);
        }
      } finally {
        writing = undefined;
      }
    })();
    return writing;
  };
}

export function parsePositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

export function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}
