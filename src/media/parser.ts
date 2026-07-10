import path from "node:path";
import type { MediaConfig, ParsedImageName, SourceImage } from "./types";
import { toPosixPath } from "./utils";

export const supportedImageExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".tif",
  ".tiff",
]);

export function isSupportedImageExtension(extension: string): boolean {
  return supportedImageExtensions.has(extension.toLowerCase());
}

export function parseImageName(stem: string, preCode: string, config: MediaConfig): ParsedImageName {
  const rule = config.preCodes[preCode];
  const separators = rule?.numericSeparators ?? config.defaultNumericSeparators;
  let rawCode = stem;
  let position = 0;
  let matchedSeparator: string | null = null;

  for (const separator of separators) {
    const parsed = splitNumericSuffix(stem, separator);
    if (!parsed) continue;
    rawCode = parsed.rawCode;
    position = parsed.position;
    matchedSeparator = separator;
    break;
  }

  let productCode = rawCode;
  for (const replacement of rule?.replacements ?? []) {
    productCode = productCode.replaceAll(replacement.from, replacement.to);
  }

  return { rawCode, productCode, position, separator: matchedSeparator };
}

export function parseSourceImage(filePath: string, cwd: string, rawDir: string, config: MediaConfig): SourceImage | null {
  const extension = path.extname(filePath).toLowerCase();
  if (!isSupportedImageExtension(extension)) return null;

  const absoluteRawDir = path.resolve(cwd, rawDir);
  const relativeToRaw = path.relative(absoluteRawDir, filePath);
  if (!relativeToRaw || relativeToRaw.startsWith("..") || path.isAbsolute(relativeToRaw)) return null;

  const segments = toPosixPath(relativeToRaw).split("/");
  if (segments.length < 2) return null;

  const preCode = segments[0]!;
  const baseName = path.basename(filePath, extension);
  const parsed = parseImageName(baseName, preCode, config);

  return {
    filePath,
    sourceKey: toPosixPath(path.relative(cwd, filePath)),
    preCode,
    extension,
    rawCode: parsed.rawCode,
    productCode: parsed.productCode,
    position: parsed.position,
    separator: parsed.separator,
  };
}

export function mimeTypeFromExtension(extension: string): string {
  switch (extension.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    default:
      return "application/octet-stream";
  }
}

function splitNumericSuffix(stem: string, separator: string): { rawCode: string; position: number } | null {
  const index = stem.lastIndexOf(separator);
  if (index <= 0) return null;
  const suffix = stem.slice(index + separator.length);
  if (!/^\d+$/.test(suffix)) return null;
  return {
    rawCode: stem.slice(0, index),
    position: Number(suffix),
  };
}
