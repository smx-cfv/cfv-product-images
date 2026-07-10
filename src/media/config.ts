import { promises as fs } from "node:fs";
import path from "node:path";
import type { MediaConfig, PreCodeRule, ReplacementRule } from "./types";

export const defaultConfigFileName = "media.config.json";

export async function readMediaConfig(cwd: string, configPath = defaultConfigFileName): Promise<MediaConfig> {
  const absolutePath = path.resolve(cwd, configPath);
  const parsed = JSON.parse(await fs.readFile(absolutePath, "utf8")) as unknown;
  return normalizeConfig(parsed, absolutePath);
}

function normalizeConfig(value: unknown, filePath: string): MediaConfig {
  if (!isRecord(value)) throw new Error(`Invalid media config: ${filePath}`);
  const config = value as Partial<MediaConfig>;

  const targetWidths = readNumberArray(config.targetWidths, "targetWidths");
  if (targetWidths.length === 0) throw new Error("media.config.json targetWidths cannot be empty.");

  return {
    rawDir: readString(config.rawDir, "rawDir"),
    processedDir: readString(config.processedDir, "processedDir"),
    productsDir: readString(config.productsDir, "productsDir"),
    manifestJsonPath: readString(config.manifestJsonPath, "manifestJsonPath"),
    manifestCsvPath: readString(config.manifestCsvPath, "manifestCsvPath"),
    stateDir: readString(config.stateDir, "stateDir"),
    targetWidths,
    defaultNumericSeparators: readStringArray(config.defaultNumericSeparators, "defaultNumericSeparators"),
    preCodes: readPreCodeRules(config.preCodes),
  };
}

function readPreCodeRules(value: unknown): Record<string, PreCodeRule> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("media.config.json preCodes must be an object.");

  const rules: Record<string, PreCodeRule> = {};
  for (const [preCode, ruleValue] of Object.entries(value)) {
    if (!isRecord(ruleValue)) throw new Error(`Invalid preCode rule for ${preCode}.`);
    const rule = ruleValue as Partial<PreCodeRule>;
    rules[preCode] = {
      ...(rule.numericSeparators !== undefined
        ? { numericSeparators: readStringArray(rule.numericSeparators, `${preCode}.numericSeparators`) }
        : {}),
      ...(rule.replacements !== undefined
        ? { replacements: readReplacementRules(rule.replacements, `${preCode}.replacements`) }
        : {}),
    };
  }
  return rules;
}

function readReplacementRules(value: unknown, label: string): ReplacementRule[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`${label}[${index}] must be an object.`);
    return {
      from: readString(item.from, `${label}[${index}].from`),
      to: typeof item.to === "string" ? item.to : "",
    };
  });
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`media.config.json ${label} must be a non-empty string.`);
  return value;
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`media.config.json ${label} must be an array of strings.`);
  }
  return value;
}

function readNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item) || item <= 0)) {
    throw new Error(`media.config.json ${label} must be an array of positive integers.`);
  }
  return [...new Set(value as number[])].sort((left, right) => left - right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
