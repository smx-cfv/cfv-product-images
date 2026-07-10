import assert from "node:assert/strict";
import test from "node:test";
import type { MediaConfig } from "./types";
import { parseImageName } from "./parser";

const config: MediaConfig = {
  rawDir: "media/raw",
  processedDir: "media/processed",
  productsDir: "media/processed/products",
  manifestJsonPath: "manifest.json",
  manifestCsvPath: "manifest.csv",
  stateDir: ".media-state",
  targetWidths: [480, 768, 1024],
  defaultNumericSeparators: ["__"],
  preCodes: {
    MANN: {
      numericSeparators: ["__", "-"],
      replacements: [
        { from: "_", to: "" },
        { from: ".", to: "/" },
      ],
    },
  },
};

test("parses double-underscore product image numbers", () => {
  assert.deepEqual(parseImageName("50268A__1", "CFV", config), {
    rawCode: "50268A",
    productCode: "50268A",
    position: 1,
    separator: "__",
  });
});

test("treats files without a number as primary position zero", () => {
  assert.deepEqual(parseImageName("60168L", "CFV", config), {
    rawCode: "60168L",
    productCode: "60168L",
    position: 0,
    separator: null,
  });
});

test("parses MANN dash suffix and applies literal prompt mapping", () => {
  assert.deepEqual(parseImageName("HU713_1X-4", "MANN", config), {
    rawCode: "HU713_1X",
    productCode: "HU7131X",
    position: 4,
    separator: "-",
  });
});

test("applies MANN underscore and dot replacements literally", () => {
  assert.deepEqual(parseImageName("C_20.500", "MANN", config), {
    rawCode: "C_20.500",
    productCode: "C20/500",
    position: 0,
    separator: null,
  });
  assert.equal(parseImageName("C_20_500", "MANN", config).productCode, "C20500");
});
