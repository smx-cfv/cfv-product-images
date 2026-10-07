import { promises as fs } from "node:fs";
import path from "node:path";
import { readMediaConfig } from "./config";
import { isSupportedImageExtension, parseSourceImage } from "./parser";
import type { MediaConfig } from "./types";
import { isMissingPathError, toPosixPath } from "./utils";

export interface PreflightIssue {
  path: string;
  message: string;
}

export interface MediaPreflightResult {
  imageCount: number;
  preCodes: string[];
  warnings: PreflightIssue[];
  errors: PreflightIssue[];
}

export interface InspectMediaInputOptions {
  cwd: string;
  config?: MediaConfig;
}

export async function inspectMediaInput(options: InspectMediaInputOptions): Promise<MediaPreflightResult> {
  const cwd = path.resolve(options.cwd);
  const config = options.config ?? await readMediaConfig(cwd);
  const rawDir = path.resolve(cwd, config.rawDir);
  const warnings: PreflightIssue[] = [];
  const errors: PreflightIssue[] = [];
  const sources = [];

  let files: string[];
  try {
    files = await listFiles(rawDir);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    return {
      imageCount: 0,
      preCodes: [],
      warnings,
      errors: [{
        path: toPosixPath(path.relative(cwd, rawDir)),
        message: "La cartella delle immagini non esiste.",
      }],
    };
  }

  for (const filePath of files) {
    const relativeToRaw = toPosixPath(path.relative(rawDir, filePath));
    const displayPath = toPosixPath(path.relative(cwd, filePath));
    const segments = relativeToRaw.split("/");
    const extension = path.extname(filePath);

    if (!isSupportedImageExtension(extension)) {
      warnings.push({
        path: displayPath,
        message: "Formato non supportato: il file verrà ignorato.",
      });
      continue;
    }

    if (segments.length !== 2) {
      errors.push({
        path: displayPath,
        message: "L'immagine deve trovarsi direttamente in media/raw/[PRECODICE]/.",
      });
      continue;
    }

    const source = parseSourceImage(filePath, cwd, config.rawDir, config);
    if (!source) {
      errors.push({
        path: displayPath,
        message: "Il percorso dell'immagine non può essere interpretato.",
      });
      continue;
    }
    sources.push(source);
  }

  const byIdentity = new Map<string, typeof sources>();
  for (const source of sources) {
    const identity = `${source.preCode}\u0000${source.rawCode}\u0000${source.position}`;
    const matches = byIdentity.get(identity) ?? [];
    matches.push(source);
    byIdentity.set(identity, matches);
  }

  for (const matches of byIdentity.values()) {
    if (matches.length < 2) continue;
    const paths = matches.map((source) => source.sourceKey).sort();
    for (const sourcePath of paths) {
      errors.push({
        path: sourcePath,
        message: `Collisione: più file genererebbero la stessa immagine (${paths.join(", ")}).`,
      });
    }
  }

  if (sources.length === 0 && errors.length === 0) {
    errors.push({
      path: toPosixPath(path.relative(cwd, rawDir)),
      message: "Non è stata trovata alcuna immagine supportata.",
    });
  }

  return {
    imageCount: sources.length,
    preCodes: [...new Set(sources.map((source) => source.preCode))].sort(),
    warnings: warnings.sort(compareIssues),
    errors: errors.sort(compareIssues),
  };
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries
    .filter((entry) => !entry.name.startsWith("."))
    .map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(entryPath);
      if (entry.isFile()) return [entryPath];
      return [];
    }));
  return files.flat().sort((left, right) => left.localeCompare(right));
}

function compareIssues(left: PreflightIssue, right: PreflightIssue): number {
  return left.path.localeCompare(right.path) || left.message.localeCompare(right.message);
}
