import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

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
  await fs.rename(temporary, target);
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
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
