export interface ReplacementRule {
  from: string;
  to: string;
}

export interface PreCodeRule {
  numericSeparators?: string[];
  replacements?: ReplacementRule[];
}

export interface MediaConfig {
  rawDir: string;
  processedDir: string;
  productsDir: string;
  manifestJsonPath: string;
  manifestCsvPath: string;
  stateDir: string;
  targetWidths: number[];
  defaultNumericSeparators: string[];
  preCodes: Record<string, PreCodeRule>;
}

export interface ParsedImageName {
  rawCode: string;
  productCode: string;
  position: number;
  separator: string | null;
}

export interface SourceImage {
  filePath: string;
  sourceKey: string;
  preCode: string;
  extension: string;
  rawCode: string;
  productCode: string;
  position: number;
  separator: string | null;
}

export interface ManifestVariant {
  width: number;
  height: number;
  object_key: string;
  slug: string;
  checksum: string;
  bytes: number;
}

export interface ManifestAsset {
  pre_code: string;
  raw_code: string;
  product_code: string;
  source_key: string;
  checksum: string;
  position: number;
  is_primary: boolean;
  source: {
    path: string;
    width: number;
    height: number;
    mime_type: string;
    bytes: number;
  };
  variants: ManifestVariant[];
}

export interface MediaManifest {
  version: 1;
  generated_at: string;
  base_url: string;
  widths: number[];
  assets: ManifestAsset[];
}

export type UploadStatus = "pending" | "uploaded";

export interface UploadQueueItem {
  object_key: string;
  source_key: string;
  source_checksum: string;
  variant_checksum: string;
  bytes: number;
  status: UploadStatus;
  uploaded_at?: string;
  e_tag?: string;
}

export interface UploadQueue {
  version: 1;
  updated_at: string;
  items: UploadQueueItem[];
}
