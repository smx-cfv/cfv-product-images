import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readMediaConfig } from "./config";
import {
  assetIdentity,
  imageCacheControl,
  localPathForObjectKey,
  manifestCacheControl,
  manifestToCsv,
  readManifest,
  sortManifestAssets,
} from "./manifest";
import type { ManifestAsset, MediaConfig, MediaManifest, UploadQueue, UploadQueueItem } from "./types";
import { atomicWriteFile, isMissingPathError, mapWithConcurrency, normalizeBaseUrl, sha256 } from "./utils";

export interface R2Credentials {
  bucketName: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface UploadObject {
  objectKey: string;
  body: Buffer;
  contentType: string;
  cacheControl: string;
}

export interface ObjectUploader {
  putObject(object: UploadObject): Promise<{ eTag?: string }>;
}

export interface UploadMediaOptions {
  cwd: string;
  baseUrl: string;
  pre?: string;
  limit?: number;
  concurrency?: number;
  confirm?: boolean;
  config?: MediaConfig;
  credentials?: R2Credentials;
  uploader?: ObjectUploader;
  fetchRemoteManifest?: (url: string) => Promise<MediaManifest | null>;
  onProgress?: (progress: UploadMediaProgress) => void;
}

export interface UploadMediaProgress {
  phase: "uploading";
  completed: number;
  total: number;
  item: string;
}

export interface UploadMediaResult {
  mode: "dry-run" | "uploaded";
  manifestPath: string;
  remoteManifestUrl: string;
  localAssets: number;
  selectedAssets: number;
  queued: number;
  uploaded: number;
  skipped: number;
  failed: number;
  manifestPublished: boolean;
  partialPublish: boolean;
  remoteAssets: number;
  preservedRemoteAssets: number;
  manifestChanged: boolean;
}

interface UploadPlanItem {
  asset: ManifestAsset;
  variant: ManifestAsset["variants"][number];
  filePath: string;
  contentChecksum: string;
  status: "pending" | "uploaded";
}

export async function uploadMedia(options: UploadMediaOptions): Promise<UploadMediaResult> {
  const cwd = path.resolve(options.cwd);
  const config = options.config ?? await readMediaConfig(cwd);
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const manifestPath = path.resolve(cwd, config.manifestJsonPath);
  const productsDir = path.resolve(cwd, config.productsDir);
  const queuePath = path.join(cwd, config.stateDir, "r2-upload-queue.json");
  const localManifest = await readManifest(manifestPath);
  if (!localManifest) throw new Error(`Missing local manifest: ${manifestPath}. Run npm run media:process first.`);

  const remoteManifestUrl = new URL("manifest.json", baseUrl).toString();
  const remoteManifest = await (options.fetchRemoteManifest ?? fetchRemoteManifest)(remoteManifestUrl);
  const queue = await readUploadQueue(queuePath);
  const selectedAssets = applyAssetFilter(localManifest.assets, options.pre, options.limit);
  const selectedIds = new Set(selectedAssets.map(assetIdentity));
  const remoteById = new Map((remoteManifest?.assets ?? []).map((asset) => [assetIdentity(asset), asset]));
  const queueByKey = new Map((queue?.items ?? []).map((item) => [queueItemIdentity(item), item]));

  const plan: UploadPlanItem[] = [];
  for (const asset of selectedAssets) {
    const remoteAsset = remoteById.get(assetIdentity(asset));
    for (const variant of asset.variants) {
      const filePath = localPathForObjectKey(productsDir, variant.object_key);
      const body = await fs.readFile(filePath);
      const contentChecksum = sha256(body);
      if (variant.checksum && contentChecksum !== variant.checksum) {
        throw new Error(`Processed file checksum mismatch for ${variant.object_key}. Run npm run media:process again.`);
      }
      const queueItem = queueByKey.get(queueItemIdentity({
        object_key: variant.object_key,
        source_checksum: asset.checksum,
        variant_checksum: contentChecksum,
      }));
      const remoteVariant = remoteAsset?.variants.find((candidate) => candidate.object_key === variant.object_key);
      const alreadyRemote = remoteAsset?.checksum === asset.checksum
        && remoteVariant?.checksum === contentChecksum
        && remoteVariant?.bytes === body.length;
      const alreadyQueued = queueItem?.status === "uploaded";
      plan.push({
        asset,
        variant,
        filePath,
        contentChecksum,
        status: alreadyRemote || alreadyQueued ? "uploaded" : "pending",
      });
    }
  }

  const pending = plan.filter((item) => item.status === "pending");
  const publishManifest = buildPublishManifest(localManifest, remoteManifest, selectedIds, baseUrl);
  const preservedRemoteAssets = countPreservedRemoteAssets(remoteManifest, selectedIds);
  const manifestChanged = !remoteManifest || !manifestsMatchForPublish(publishManifest, remoteManifest);
  const confirm = Boolean(options.confirm);
  if (!confirm) {
    return {
      mode: "dry-run",
      manifestPath,
      remoteManifestUrl,
      localAssets: localManifest.assets.length,
      selectedAssets: selectedAssets.length,
      queued: pending.length,
      uploaded: 0,
      skipped: plan.length - pending.length,
      failed: 0,
      manifestPublished: false,
      partialPublish: isPartialUpload(localManifest.assets, selectedIds),
      remoteAssets: remoteManifest?.assets.length ?? 0,
      preservedRemoteAssets,
      manifestChanged,
    };
  }

  if (pending.length === 0 && !manifestChanged) {
    return {
      mode: "uploaded",
      manifestPath,
      remoteManifestUrl,
      localAssets: localManifest.assets.length,
      selectedAssets: selectedAssets.length,
      queued: 0,
      uploaded: 0,
      skipped: plan.length,
      failed: 0,
      manifestPublished: false,
      partialPublish: isPartialUpload(localManifest.assets, selectedIds),
      remoteAssets: remoteManifest?.assets.length ?? 0,
      preservedRemoteAssets,
      manifestChanged: false,
    };
  }

  const uploader = options.uploader ?? createR2Uploader(requiredCredentials(options.credentials));
  let uploaded = 0;
  const uploadedItems = new Map<string, UploadQueueItem>();
  const concurrency = options.concurrency ?? 6;

  await mapWithConcurrency(pending, concurrency, async (item) => {
    const body = await fs.readFile(item.filePath);
    const response = await uploader.putObject({
      objectKey: item.variant.object_key,
      body,
      contentType: "image/webp",
      cacheControl: imageCacheControl,
    });
    uploaded += 1;
    const completed = uploaded;
    const queueItem: UploadQueueItem = {
      object_key: item.variant.object_key,
      source_key: item.asset.source_key,
      source_checksum: item.asset.checksum,
      variant_checksum: item.contentChecksum,
      bytes: item.variant.bytes,
      status: "uploaded",
      uploaded_at: new Date().toISOString(),
      ...(response.eTag ? { e_tag: response.eTag } : {}),
    };
    uploadedItems.set(queueItemIdentity(queueItem), queueItem);
    await writeUploadQueue(queuePath, mergeQueue(queue, [...uploadedItems.values()]));
    options.onProgress?.({
      phase: "uploading",
      completed,
      total: pending.length,
      item: item.variant.object_key,
    });
  });

  const nextQueue = mergeQueue(queue, [
    ...plan
      .filter((item) => item.status === "uploaded")
      .map((item): UploadQueueItem => ({
        object_key: item.variant.object_key,
        source_key: item.asset.source_key,
        source_checksum: item.asset.checksum,
        variant_checksum: item.contentChecksum,
        bytes: item.variant.bytes,
        status: "uploaded",
      })),
    ...uploadedItems.values(),
  ]);
  await writeUploadQueue(queuePath, nextQueue);

  await uploader.putObject({
    objectKey: "manifest.csv",
    body: Buffer.from(manifestToCsv(publishManifest), "utf8"),
    contentType: "text/csv; charset=utf-8",
    cacheControl: manifestCacheControl,
  });
  await uploader.putObject({
    objectKey: "manifest.json",
    body: Buffer.from(`${JSON.stringify(publishManifest, null, 2)}\n`, "utf8"),
    contentType: "application/json; charset=utf-8",
    cacheControl: manifestCacheControl,
  });

  return {
    mode: "uploaded",
    manifestPath,
    remoteManifestUrl,
    localAssets: localManifest.assets.length,
    selectedAssets: selectedAssets.length,
    queued: pending.length,
    uploaded,
    skipped: plan.length - pending.length,
    failed: 0,
    manifestPublished: true,
    partialPublish: isPartialUpload(localManifest.assets, selectedIds),
    remoteAssets: remoteManifest?.assets.length ?? 0,
    preservedRemoteAssets,
    manifestChanged,
  };
}

export function createR2Uploader(credentials: R2Credentials): ObjectUploader {
  const client = new S3Client({
    endpoint: credentials.endpoint,
    region: "auto",
    forcePathStyle: true,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });

  return {
    async putObject(object) {
      const response = await client.send(new PutObjectCommand({
        Bucket: credentials.bucketName,
        Key: object.objectKey,
        Body: object.body,
        ContentType: object.contentType,
        CacheControl: object.cacheControl,
      }));
      return {
        ...(response.ETag ? { eTag: response.ETag.replaceAll("\"", "") } : {}),
      };
    },
  };
}

export async function fetchRemoteManifest(url: string): Promise<MediaManifest | null> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not fetch remote manifest (${url}): HTTP ${response.status}`);
  const parsed = await response.json() as unknown;
  if (!isMediaManifest(parsed)) throw new Error(`Invalid remote manifest: ${url}`);
  return parsed;
}

export function credentialsFromEnv(env: NodeJS.ProcessEnv): R2Credentials | undefined {
  const bucketName = env.R2_BUCKET_NAME?.trim();
  const endpoint = env.R2_ENDPOINT?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!bucketName && !endpoint && !accessKeyId && !secretAccessKey) return undefined;
  return {
    bucketName: requiredEnv(bucketName, "R2_BUCKET_NAME"),
    endpoint: requiredEnv(endpoint, "R2_ENDPOINT"),
    accessKeyId: requiredEnv(accessKeyId, "R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv(secretAccessKey, "R2_SECRET_ACCESS_KEY"),
  };
}

async function readUploadQueue(filePath: string): Promise<UploadQueue | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    if (!isUploadQueue(parsed)) throw new Error(`Invalid upload queue: ${filePath}`);
    return parsed;
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

async function writeUploadQueue(filePath: string, queue: UploadQueue): Promise<void> {
  await atomicWriteFile(filePath, `${JSON.stringify(queue, null, 2)}\n`);
}

function mergeQueue(previous: UploadQueue | null, uploadedItems: UploadQueueItem[]): UploadQueue {
  const items = new Map((previous?.items ?? []).map((item) => [queueItemIdentity(item), item]));
  for (const item of uploadedItems) items.set(queueItemIdentity(item), item);
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    items: [...items.values()].sort((left, right) => left.object_key.localeCompare(right.object_key)),
  };
}

function queueItemIdentity(item: Pick<UploadQueueItem, "object_key" | "source_checksum" | "variant_checksum">): string {
  return `${item.object_key}\u0000${item.source_checksum}\u0000${item.variant_checksum}`;
}

function applyAssetFilter(assets: ManifestAsset[], pre: string | undefined, limit: number | undefined): ManifestAsset[] {
  const filtered = pre ? assets.filter((asset) => asset.pre_code === pre) : assets;
  return limit ? filtered.slice(0, limit) : filtered;
}

function isPartialUpload(allAssets: ManifestAsset[], selectedIds: Set<string>): boolean {
  return allAssets.some((asset) => !selectedIds.has(assetIdentity(asset)));
}

function buildPublishManifest(
  localManifest: MediaManifest,
  remoteManifest: MediaManifest | null,
  selectedIds: Set<string>,
  baseUrl: string,
): MediaManifest {
  const assets = new Map((remoteManifest?.assets ?? []).map((asset) => [assetIdentity(asset), asset]));
  for (const asset of localManifest.assets) {
    if (selectedIds.has(assetIdentity(asset))) assets.set(assetIdentity(asset), asset);
  }

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    widths: localManifest.widths,
    assets: sortManifestAssets([...assets.values()]),
  };
}

function countPreservedRemoteAssets(
  remoteManifest: MediaManifest | null,
  selectedIds: Set<string>,
): number {
  return (remoteManifest?.assets ?? [])
    .filter((asset) => !selectedIds.has(assetIdentity(asset)))
    .length;
}

function manifestsMatchForPublish(left: MediaManifest, right: MediaManifest): boolean {
  return JSON.stringify({
    version: left.version,
    base_url: left.base_url,
    widths: left.widths,
    assets: left.assets,
  }) === JSON.stringify({
    version: right.version,
    base_url: right.base_url,
    widths: right.widths,
    assets: right.assets,
  });
}

function requiredCredentials(credentials: R2Credentials | undefined): R2Credentials {
  if (!credentials) throw new Error("Missing R2 credentials. Check R2_BUCKET_NAME, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.");
  return credentials;
}

function requiredEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function isUploadQueue(value: unknown): value is UploadQueue {
  if (!value || typeof value !== "object") return false;
  const queue = value as Partial<UploadQueue>;
  return queue.version === 1
    && typeof queue.updated_at === "string"
    && Array.isArray(queue.items)
    && queue.items.every((item) => (
      item
      && typeof item.object_key === "string"
      && typeof item.source_key === "string"
      && typeof item.source_checksum === "string"
      && typeof item.variant_checksum === "string"
      && Number.isFinite(item.bytes)
      && (item.status === "pending" || item.status === "uploaded")
    ));
}

function isMediaManifest(value: unknown): value is MediaManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<MediaManifest>;
  return manifest.version === 1
    && typeof manifest.generated_at === "string"
    && typeof manifest.base_url === "string"
    && Array.isArray(manifest.widths)
    && Array.isArray(manifest.assets);
}
