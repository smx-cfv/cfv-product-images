import assert from "node:assert/strict";
import test from "node:test";
import type { GuidedWorkflowDependencies } from "./guided";
import { runGuidedWorkflow, validateGuidedEnvironment } from "./guided";
import type { ProcessMediaResult } from "./media/process";
import type { UploadMediaResult } from "./media/upload";

const environment = {
  R2_BUCKET_NAME: "bucket",
  R2_BUCKET_DOMAIN: "https://img.example.test",
  R2_ACCESS_KEY_ID: "access-secret-value",
  R2_SECRET_ACCESS_KEY: "secret-secret-value",
  R2_ENDPOINT: "https://endpoint.example.test",
};

const processResult: ProcessMediaResult = {
  mode: "processed",
  manifestPath: "/tmp/manifest.json",
  csvPath: "/tmp/manifest.csv",
  scanned: 1,
  selected: 1,
  assets: 1,
  generatedAssets: 1,
  reusedAssets: 0,
  preservedAssets: 0,
  variants: 2,
  bytes: 100,
  durationMs: 10,
};

function uploadResult(overrides: Partial<UploadMediaResult> = {}): UploadMediaResult {
  return {
    mode: "dry-run",
    manifestPath: "/tmp/manifest.json",
    remoteManifestUrl: "https://img.example.test/manifest.json",
    localAssets: 1,
    selectedAssets: 1,
    queued: 2,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    manifestPublished: false,
    partialPublish: false,
    remoteAssets: 0,
    preservedRemoteAssets: 0,
    manifestChanged: true,
    ...overrides,
  };
}

function baseDependencies(): GuidedWorkflowDependencies {
  return {
    inspect: async () => ({
      imageCount: 1,
      preCodes: ["CFV"],
      warnings: [],
      errors: [],
    }),
    process: async () => processResult,
    write: () => undefined,
  };
}

test("guided workflow uploads only after explicit confirmation", async () => {
  const calls: boolean[] = [];
  const dependencies = baseDependencies();
  dependencies.confirm = async () => true;
  dependencies.upload = async (options) => {
    calls.push(Boolean(options.confirm));
    return options.confirm
      ? uploadResult({ mode: "uploaded", uploaded: 2, manifestPublished: true })
      : uploadResult();
  };

  const result = await runGuidedWorkflow({ cwd: "/tmp", env: environment, dependencies });

  assert.equal(result.status, "uploaded");
  assert.deepEqual(calls, [false, true]);
});

test("guided workflow keeps local processing results when upload is refused", async () => {
  let uploadCalls = 0;
  const dependencies = baseDependencies();
  dependencies.confirm = async () => false;
  dependencies.upload = async () => {
    uploadCalls += 1;
    return uploadResult();
  };

  const result = await runGuidedWorkflow({ cwd: "/tmp", env: environment, dependencies });

  assert.equal(result.status, "cancelled");
  assert.equal(uploadCalls, 1);
});

test("guided workflow skips confirmation when remote state is already current", async () => {
  let confirmationCalls = 0;
  const dependencies = baseDependencies();
  dependencies.confirm = async () => {
    confirmationCalls += 1;
    return true;
  };
  dependencies.upload = async () => uploadResult({
    queued: 0,
    skipped: 2,
    manifestChanged: false,
  });

  const result = await runGuidedWorkflow({ cwd: "/tmp", env: environment, dependencies });

  assert.equal(result.status, "up-to-date");
  assert.equal(confirmationCalls, 0);
});

test("environment validation reports only missing variable names and never secret values", () => {
  const invalidEnvironment = {
    ...environment,
    R2_BUCKET_NAME: "",
  };

  assert.throws(
    () => validateGuidedEnvironment(invalidEnvironment),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /R2_BUCKET_NAME/);
      assert.doesNotMatch(message, /access-secret-value|secret-secret-value/);
      return true;
    },
  );
});
