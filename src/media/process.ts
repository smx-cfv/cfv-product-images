import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { readMediaConfig } from "./config";
import {
  buildVariantObjectKey,
  fileChecksum,
  localPathForObjectKey,
  markPrimaryAssets,
  readManifest,
  refreshAssetUrls,
  sortManifestAssets,
  targetVariantWidths,
  variantsMatchWidths,
  writeManifestFiles,
} from "./manifest";
import { mimeTypeFromExtension, parseSourceImage } from "./parser";
import type { ManifestAsset, ManifestVariant, MediaConfig, MediaManifest, SourceImage } from "./types";
import {
  atomicWriteFile,
  isMissingPathError,
  mapWithConcurrency,
  normalizeBaseUrl,
  pathExists,
  publicUrlForObjectKey,
  sha256,
  toPosixPath,
} from "./utils";

export interface ProcessMediaOptions {
  cwd: string;
  baseUrl: string;
  pre?: string;
  limit?: number;
  concurrency?: number;
  dryRun?: boolean;
  resume?: boolean;
  config?: MediaConfig;
  onProgress?: (progress: ProcessMediaProgress) => void;
}

export interface ProcessMediaProgress {
  phase: "processing";
  completed: number;
  total: number;
  item: string;
  action: "generated" | "reused" | "preserved";
}

export interface ProcessMediaResult {
  mode: "dry-run" | "processed";
  manifestPath: string;
  csvPath: string;
  scanned: number;
  selected: number;
  assets: number;
  generatedAssets: number;
  reusedAssets: number;
  preservedAssets: number;
  variants: number;
  bytes: number;
  durationMs: number;
}

interface PreparedAsset {
  asset: ManifestAsset;
  action: "generated" | "reused" | "preserved";
}

export async function processMedia(options: ProcessMediaOptions): Promise<ProcessMediaResult> {
  const startedAt = performance.now();
  const cwd = path.resolve(options.cwd);
  const config = options.config ?? await readMediaConfig(cwd);
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const rawDir = path.resolve(cwd, config.rawDir);
  const processedDir = path.resolve(cwd, config.processedDir);
  const productsDir = path.resolve(cwd, config.productsDir);
  const manifestPath = path.resolve(cwd, config.manifestJsonPath);
  const csvPath = path.resolve(cwd, config.manifestCsvPath);
  const stateDir = path.resolve(cwd, config.stateDir);
  const concurrency = options.concurrency ?? 4;
  const dryRun = Boolean(options.dryRun);

  assertOutputOutsideRaw(rawDir, productsDir);

  const [sources, previousManifest] = await Promise.all([
    discoverSourceImages(cwd, rawDir, config),
    readManifest(manifestPath),
  ]);
  const previousBySource = new Map((previousManifest?.assets ?? []).map((asset) => [asset.source_key, asset]));
  const selectedSources = applySourceFilter(sources, options.pre, options.limit);
  const selectedKeys = new Set(selectedSources.map((source) => source.sourceKey));
  const finalSources = sources.filter((source) => selectedKeys.has(source.sourceKey) || previousBySource.has(source.sourceKey));
  const stageDir = path.join(processedDir, `.stage-${process.pid}-${Date.now()}`);
  const stageProductsDir = path.join(stageDir, "products");

  if (!dryRun) {
    await fs.rm(stageDir, { recursive: true, force: true });
    await fs.mkdir(stageProductsDir, { recursive: true });
  }

  let prepared: PreparedAsset[];
  let completed = 0;
  try {
    prepared = await mapWithConcurrency(finalSources, concurrency, async (source) => {
      const previous = previousBySource.get(source.sourceKey) ?? null;
      let result: PreparedAsset;
      if (!selectedKeys.has(source.sourceKey)) {
        if (!previous) throw new Error(`Cannot preserve missing previous asset for ${source.sourceKey}`);
        result = await preservePreviousAsset(previous, productsDir, stageProductsDir, baseUrl, dryRun);
      } else {
        result = await prepareSourceAsset(source, previous, config, productsDir, stageProductsDir, baseUrl, dryRun);
      }
      completed += 1;
      options.onProgress?.({
        phase: "processing",
        completed,
        total: finalSources.length,
        item: source.sourceKey,
        action: result.action,
      });
      return result;
    });
  } catch (error) {
    if (!dryRun) await fs.rm(stageDir, { recursive: true, force: true });
    throw error;
  }

  const assets = markPrimaryAssets(prepared.map((item) => item.asset));
  const manifest: MediaManifest = {
    version: 1,
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    widths: config.targetWidths,
    assets,
  };

  if (!dryRun) {
    try {
      await promoteProcessedProducts(stageDir, stageProductsDir, productsDir);
      await writeManifestFiles(manifestPath, csvPath, manifest);
      await writeProcessState(stateDir, {
        pre: options.pre ?? null,
        limit: options.limit ?? null,
        selected: selectedSources.length,
        assets: manifest.assets.length,
        last_source_key: selectedSources.at(-1)?.sourceKey ?? null,
        resume: Boolean(options.resume),
      });
    } catch (error) {
      await fs.rm(stageDir, { recursive: true, force: true });
      throw error;
    }
  } else {
    await fs.rm(stageDir, { recursive: true, force: true });
  }

  return {
    mode: dryRun ? "dry-run" : "processed",
    manifestPath,
    csvPath,
    scanned: sources.length,
    selected: selectedSources.length,
    assets: manifest.assets.length,
    generatedAssets: prepared.filter((item) => item.action === "generated").length,
    reusedAssets: prepared.filter((item) => item.action === "reused").length,
    preservedAssets: prepared.filter((item) => item.action === "preserved").length,
    variants: manifest.assets.reduce((total, asset) => total + asset.variants.length, 0),
    bytes: manifest.assets.reduce((total, asset) => total + asset.variants.reduce((sum, variant) => sum + variant.bytes, 0), 0),
    durationMs: Math.round(performance.now() - startedAt),
  };
}

export async function discoverSourceImages(cwd: string, rawDir: string, config: MediaConfig): Promise<SourceImage[]> {
  const files = await listFiles(rawDir);
  return files
    .map((filePath) => parseSourceImage(filePath, cwd, config.rawDir, config))
    .filter((source): source is SourceImage => Boolean(source))
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
}

async function prepareSourceAsset(
  source: SourceImage,
  previous: ManifestAsset | null,
  config: MediaConfig,
  productsDir: string,
  stageProductsDir: string,
  baseUrl: string,
  dryRun: boolean,
): Promise<PreparedAsset> {
  const sourceBuffer = await fs.readFile(source.filePath);
  const checksum = sha256(sourceBuffer);
  const stat = await fs.stat(source.filePath);
  const metadata = await sharp(sourceBuffer).metadata();
  const dimensions = orientedDimensions(metadata.width, metadata.height, metadata.orientation);
  if (!dimensions.width || !dimensions.height) throw new Error(`Could not read dimensions for ${source.sourceKey}`);
  const widths = targetVariantWidths(dimensions.width, config.targetWidths);

  if (previous
    && previous.checksum === checksum
    && variantsMatchWidths(previous.variants, widths)
    && await canReuseAsset(previous, productsDir)
  ) {
    const asset = rebuildAssetFromPrevious(source, previous, checksum, dimensions, stat.size, baseUrl);
    if (!dryRun) await copyAssetVariants(asset, productsDir, stageProductsDir);
    return { asset, action: "reused" };
  }

  const variants: ManifestVariant[] = [];
  if (!dryRun) {
    const image = sharp(sourceBuffer).rotate();
    for (const width of widths) {
      const output = await image.clone()
        .resize({ width, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85, effort: 6 })
        .toBuffer({ resolveWithObject: true });
      const actualWidth = output.info.width;
      const actualHeight = output.info.height;
      if (!actualWidth || !actualHeight) throw new Error(`Could not resize ${source.sourceKey} to ${width}px`);
      const objectKey = buildVariantObjectKey(source.preCode, source.rawCode, source.position, actualWidth);
      const variant = {
        width: actualWidth,
        height: actualHeight,
        object_key: objectKey,
        slug: publicUrlForObjectKey(baseUrl, objectKey),
        checksum: sha256(output.data),
        bytes: output.data.length,
      };
      await fs.mkdir(path.dirname(localPathForObjectKey(stageProductsDir, objectKey)), { recursive: true });
      await fs.writeFile(localPathForObjectKey(stageProductsDir, objectKey), output.data);
      variants.push(variant);
    }
  } else {
    for (const width of widths) {
      const height = Math.round((dimensions.height / dimensions.width) * width);
      const objectKey = buildVariantObjectKey(source.preCode, source.rawCode, source.position, width);
      variants.push({
        width,
        height,
        object_key: objectKey,
        slug: publicUrlForObjectKey(baseUrl, objectKey),
        checksum: previous?.variants.find((variant) => variant.width === width)?.checksum ?? "",
        bytes: previous?.variants.find((variant) => variant.width === width)?.bytes ?? 0,
      });
    }
  }

  return {
    asset: {
      pre_code: source.preCode,
      raw_code: source.rawCode,
      product_code: source.productCode,
      source_key: source.sourceKey,
      checksum,
      position: source.position,
      is_primary: false,
      source: {
        path: source.sourceKey,
        width: dimensions.width,
        height: dimensions.height,
        mime_type: mimeTypeFromExtension(source.extension),
        bytes: stat.size,
      },
      variants: variants.sort((left, right) => left.width - right.width),
    },
    action: "generated",
  };
}

async function preservePreviousAsset(
  previous: ManifestAsset,
  productsDir: string,
  stageProductsDir: string,
  baseUrl: string,
  dryRun: boolean,
): Promise<PreparedAsset> {
  if (!await canReuseAsset(previous, productsDir)) {
    throw new Error(`Cannot preserve ${previous.source_key}: processed variants are missing or stale.`);
  }
  const asset = refreshAssetUrls(previous, baseUrl);
  if (!dryRun) await copyAssetVariants(asset, productsDir, stageProductsDir);
  return { asset, action: "preserved" };
}

function rebuildAssetFromPrevious(
  source: SourceImage,
  previous: ManifestAsset,
  checksum: string,
  dimensions: { width: number; height: number },
  sourceBytes: number,
  baseUrl: string,
): ManifestAsset {
  return refreshAssetUrls({
    ...previous,
    pre_code: source.preCode,
    raw_code: source.rawCode,
    product_code: source.productCode,
    source_key: source.sourceKey,
    checksum,
    position: source.position,
    is_primary: false,
    source: {
      path: source.sourceKey,
      width: dimensions.width,
      height: dimensions.height,
      mime_type: mimeTypeFromExtension(source.extension),
      bytes: sourceBytes,
    },
  }, baseUrl);
}

async function canReuseAsset(asset: ManifestAsset, productsDir: string): Promise<boolean> {
  for (const variant of asset.variants) {
    const filePath = localPathForObjectKey(productsDir, variant.object_key);
    if (!await pathExists(filePath)) return false;
    if (variant.checksum && await fileChecksum(filePath) !== variant.checksum) return false;
  }
  return true;
}

async function copyAssetVariants(asset: ManifestAsset, productsDir: string, stageProductsDir: string): Promise<void> {
  for (const variant of asset.variants) {
    const sourcePath = localPathForObjectKey(productsDir, variant.object_key);
    const targetPath = localPathForObjectKey(stageProductsDir, variant.object_key);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }
}

function applySourceFilter(sources: SourceImage[], pre: string | undefined, limit: number | undefined): SourceImage[] {
  const filtered = pre ? sources.filter((source) => source.preCode === pre) : sources;
  return limit ? filtered.slice(0, limit) : filtered;
}

async function listFiles(directory: string): Promise<string[]> {
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }

  const files = await Promise.all(entries
    .filter((entry) => !entry.name.startsWith("."))
    .map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(entryPath);
      if (entry.isFile()) return [entryPath];
      return [];
    }));
  return files.flat().sort((left, right) => toPosixPath(left).localeCompare(toPosixPath(right)));
}

async function promoteProcessedProducts(stageDir: string, stageProductsDir: string, productsDir: string): Promise<void> {
  const backupDir = `${productsDir}.bak-${process.pid}-${Date.now()}`;
  await fs.mkdir(path.dirname(productsDir), { recursive: true });
  await fs.rm(backupDir, { recursive: true, force: true });

  try {
    if (await pathExists(productsDir)) await fs.rename(productsDir, backupDir);
    await fs.rename(stageProductsDir, productsDir);
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.rm(stageDir, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(productsDir, { recursive: true, force: true });
    if (await pathExists(backupDir)) await fs.rename(backupDir, productsDir);
    throw error;
  }
}

async function writeProcessState(stateDir: string, payload: Record<string, unknown>): Promise<void> {
  await atomicWriteFile(path.join(stateDir, "process-state.json"), `${JSON.stringify({
    version: 1,
    updated_at: new Date().toISOString(),
    ...payload,
  }, null, 2)}\n`);
}

function orientedDimensions(width: number | undefined, height: number | undefined, orientation: number | undefined): { width: number; height: number } {
  if (!width || !height) return { width: 0, height: 0 };
  return orientation && orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

function assertOutputOutsideRaw(rawDir: string, productsDir: string): void {
  const relative = path.relative(rawDir, productsDir);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("Processed products directory must not overlap media/raw.");
  }
}
