import { promises as fs } from "node:fs";
import path from "node:path";
import type { ManifestAsset, ManifestVariant, MediaManifest } from "./types";
import { atomicWriteFile, isMissingPathError, publicUrlForObjectKey, sha256, uniqueSortedNumbers } from "./utils";

export const imageCacheControl = "public, max-age=3600";
export const manifestCacheControl = "no-cache, max-age=0, must-revalidate";

export function assetIdentity(asset: Pick<ManifestAsset, "pre_code" | "raw_code" | "position">): string {
  return `${asset.pre_code}\u0000${asset.raw_code}\u0000${asset.position}`;
}

export function buildVariantObjectKey(preCode: string, rawCode: string, position: number, width: number): string {
  return `products/${preCode}__${rawCode}__${position}-${width}.webp`;
}

export function localPathForObjectKey(productsDir: string, objectKey: string): string {
  if (!objectKey.startsWith("products/")) {
    throw new Error(`Unsupported product object key: ${objectKey}`);
  }
  return path.join(productsDir, objectKey.slice("products/".length));
}

export function targetVariantWidths(sourceWidth: number, targetWidths: number[]): number[] {
  const widths = targetWidths.filter((width) => width <= sourceWidth);
  return widths.length > 0 ? uniqueSortedNumbers(widths) : [sourceWidth];
}

export function refreshAssetUrls(asset: ManifestAsset, baseUrl: string): ManifestAsset {
  return {
    ...asset,
    variants: asset.variants.map((variant) => ({
      ...variant,
      slug: publicUrlForObjectKey(baseUrl, variant.object_key),
    })),
  };
}

export function sortManifestAssets(assets: ManifestAsset[]): ManifestAsset[] {
  return [...assets].sort((left, right) => (
    left.pre_code.localeCompare(right.pre_code)
    || left.product_code.localeCompare(right.product_code)
    || left.position - right.position
    || left.raw_code.localeCompare(right.raw_code)
    || left.source_key.localeCompare(right.source_key)
  ));
}

export function markPrimaryAssets(assets: ManifestAsset[]): ManifestAsset[] {
  const sorted = sortManifestAssets(assets);
  const primaryByProduct = new Map<string, string>();

  for (const asset of sorted) {
    const key = `${asset.pre_code}\u0000${asset.product_code}`;
    const current = primaryByProduct.get(key);
    if (!current) {
      primaryByProduct.set(key, assetIdentity(asset));
      continue;
    }

    const currentAsset = sorted.find((candidate) => assetIdentity(candidate) === current);
    if (currentAsset && asset.position < currentAsset.position) {
      primaryByProduct.set(key, assetIdentity(asset));
    }
  }

  return sorted.map((asset) => ({
    ...asset,
    is_primary: primaryByProduct.get(`${asset.pre_code}\u0000${asset.product_code}`) === assetIdentity(asset),
  }));
}

export async function readManifest(filePath: string): Promise<MediaManifest | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    if (!isMediaManifest(parsed)) throw new Error(`Invalid media manifest: ${filePath}`);
    return parsed;
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

export async function writeManifestFiles(
  jsonPath: string,
  csvPath: string,
  manifest: MediaManifest,
): Promise<void> {
  await Promise.all([
    atomicWriteFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`),
    atomicWriteFile(csvPath, manifestToCsv(manifest)),
  ]);
}

export function manifestToCsv(manifest: MediaManifest): string {
  const headers = [
    "pre_code",
    "product_code",
    "raw_code",
    "source_key",
    "checksum",
    "position",
    "is_primary",
    "available_widths",
    "slug_480",
    "slug_768",
    "slug_1024",
    "slug_fallback",
  ];

  const rows = manifest.assets.map((asset) => {
    const byWidth = new Map(asset.variants.map((variant) => [variant.width, variant]));
    const fallback = asset.variants.find((variant) => !manifest.widths.includes(variant.width));
    return [
      asset.pre_code,
      asset.product_code,
      asset.raw_code,
      asset.source_key,
      asset.checksum,
      String(asset.position),
      String(asset.is_primary),
      asset.variants.map((variant) => variant.width).join("|"),
      byWidth.get(480)?.slug ?? "",
      byWidth.get(768)?.slug ?? "",
      byWidth.get(1024)?.slug ?? "",
      fallback?.slug ?? "",
    ].map(csvCell).join(",");
  });

  return `${headers.join(",")}\n${rows.join("\n")}${rows.length > 0 ? "\n" : ""}`;
}

export async function fileChecksum(filePath: string): Promise<string> {
  return sha256(await fs.readFile(filePath));
}

export function variantsMatchWidths(variants: ManifestVariant[], widths: number[]): boolean {
  const actual = variants.map((variant) => variant.width).sort((left, right) => left - right);
  const expected = [...widths].sort((left, right) => left - right);
  return actual.length === expected.length && actual.every((width, index) => width === expected[index]);
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function isMediaManifest(value: unknown): value is MediaManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<MediaManifest>;
  return manifest.version === 1
    && typeof manifest.generated_at === "string"
    && typeof manifest.base_url === "string"
    && Array.isArray(manifest.widths)
    && Array.isArray(manifest.assets)
    && manifest.assets.every(isManifestAsset);
}

function isManifestAsset(value: unknown): value is ManifestAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<ManifestAsset>;
  return typeof asset.pre_code === "string"
    && typeof asset.raw_code === "string"
    && typeof asset.product_code === "string"
    && typeof asset.source_key === "string"
    && typeof asset.checksum === "string"
    && Number.isFinite(asset.position)
    && typeof asset.is_primary === "boolean"
    && Boolean(asset.source)
    && Array.isArray(asset.variants)
    && asset.variants.every((variant) => (
      variant
      && Number.isFinite(variant.width)
      && Number.isFinite(variant.height)
      && typeof variant.object_key === "string"
      && typeof variant.slug === "string"
      && typeof variant.checksum === "string"
      && Number.isFinite(variant.bytes)
    ));
}
