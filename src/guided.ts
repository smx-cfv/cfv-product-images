import type { ProcessMediaOptions, ProcessMediaResult, ProcessMediaProgress } from "./media/process";
import { processMedia } from "./media/process";
import type { MediaPreflightResult } from "./media/preflight";
import { inspectMediaInput } from "./media/preflight";
import type {
  R2Credentials,
  UploadMediaOptions,
  UploadMediaProgress,
  UploadMediaResult,
} from "./media/upload";
import { credentialsFromEnv, uploadMedia } from "./media/upload";

export interface GuidedWorkflowDependencies {
  inspect?: (options: { cwd: string }) => Promise<MediaPreflightResult>;
  process?: (options: ProcessMediaOptions) => Promise<ProcessMediaResult>;
  upload?: (options: UploadMediaOptions) => Promise<UploadMediaResult>;
  confirm?: (question: string) => Promise<boolean>;
  write?: (message: string) => void;
}

export interface GuidedWorkflowOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  dependencies?: GuidedWorkflowDependencies;
}

export interface GuidedWorkflowResult {
  status: "cancelled" | "uploaded" | "up-to-date";
  process: ProcessMediaResult;
  uploadPreview: UploadMediaResult;
  upload?: UploadMediaResult;
}

interface GuidedEnvironment {
  baseUrl: string;
  credentials: R2Credentials;
}

export async function runGuidedWorkflow(options: GuidedWorkflowOptions): Promise<GuidedWorkflowResult> {
  const dependencies = options.dependencies ?? {};
  const inspect = dependencies.inspect ?? inspectMediaInput;
  const runProcess = dependencies.process ?? processMedia;
  const runUpload = dependencies.upload ?? uploadMedia;
  const confirm = dependencies.confirm ?? missingConfirmation;
  const write = dependencies.write ?? defaultWrite;
  const environment = validateGuidedEnvironment(options.env);

  write("\nCFV Product Images\n");
  write("==================\n\n");
  write("1/3  Controllo delle immagini e della configurazione...\n");

  const preflight = await inspect({ cwd: options.cwd });
  printPreflight(preflight, write);
  if (preflight.errors.length > 0) {
    throw new Error("Correggi gli errori indicati e avvia nuovamente il programma.");
  }

  write(`\n2/3  Elaborazione di ${preflight.imageCount} ${preflight.imageCount === 1 ? "immagine" : "immagini"}...\n`);
  const processResult = await runProcess({
    cwd: options.cwd,
    baseUrl: environment.baseUrl,
    onProgress: createProgressWriter("Elaborazione", write),
  });
  write([
    "\nElaborazione completata:",
    `- immagini analizzate: ${processResult.scanned}`,
    `- immagini generate: ${processResult.generatedAssets}`,
    `- immagini già aggiornate: ${processResult.reusedAssets}`,
    `- varianti disponibili: ${processResult.variants}`,
    "",
  ].join("\n"));

  write("\n3/3  Verifica delle modifiche da caricare su R2...\n");
  const uploadPreview = await runUpload({
    cwd: options.cwd,
    baseUrl: environment.baseUrl,
    credentials: environment.credentials,
  });
  printUploadPreview(uploadPreview, write);

  if (uploadPreview.queued === 0 && !uploadPreview.manifestChanged) {
    write("\nÈ già tutto aggiornato. Nessun caricamento necessario.\n");
    return {
      status: "up-to-date",
      process: processResult,
      uploadPreview,
    };
  }

  const accepted = await confirm("\nVuoi caricare queste modifiche su R2? [s/N] ");
  if (!accepted) {
    write("\nCaricamento annullato. Le immagini elaborate restano disponibili sul computer.\n");
    return {
      status: "cancelled",
      process: processResult,
      uploadPreview,
    };
  }

  write("\nCaricamento in corso. Non chiudere questa finestra...\n");
  const uploadResult = await runUpload({
    cwd: options.cwd,
    baseUrl: environment.baseUrl,
    credentials: environment.credentials,
    confirm: true,
    onProgress: createProgressWriter("Upload", write),
  });
  write([
    "\nCaricamento completato:",
    `- file caricati: ${uploadResult.uploaded}`,
    `- file già presenti: ${uploadResult.skipped}`,
    `- manifest pubblicato: ${uploadResult.manifestPublished ? "sì" : "non necessario"}`,
    `- indirizzo manifest: ${uploadResult.remoteManifestUrl}`,
    "",
  ].join("\n"));

  return {
    status: "uploaded",
    process: processResult,
    uploadPreview,
    upload: uploadResult,
  };
}

export function validateGuidedEnvironment(env: NodeJS.ProcessEnv): GuidedEnvironment {
  const missing = [
    "R2_BUCKET_NAME",
    "R2_BUCKET_DOMAIN",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_ENDPOINT",
  ].filter((name) => !env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(`Configurazione R2 incompleta. Variabili mancanti nel file .env: ${missing.join(", ")}.`);
  }

  const credentials = credentialsFromEnv(env);
  if (!credentials) {
    throw new Error("Configurazione R2 incompleta nel file .env.");
  }

  return {
    baseUrl: env.R2_BUCKET_DOMAIN!.trim(),
    credentials,
  };
}

function printPreflight(result: MediaPreflightResult, write: (message: string) => void): void {
  const imageLabel = result.imageCount === 1 ? "immagine" : "immagini";
  const folderLabel = result.preCodes.length === 1 ? "cartella precodice" : "cartelle precodice";
  write(`Trovate ${result.imageCount} ${imageLabel} in ${result.preCodes.length} ${folderLabel}.\n`);
  for (const warning of result.warnings) {
    write(`ATTENZIONE  ${warning.path}: ${warning.message}\n`);
  }
  for (const error of result.errors) {
    write(`ERRORE      ${error.path}: ${error.message}\n`);
  }
}

function printUploadPreview(result: UploadMediaResult, write: (message: string) => void): void {
  write([
    "Modifiche pronte:",
    `- nuovi file o file modificati: ${result.queued}`,
    `- file già presenti: ${result.skipped}`,
    `- aggiornamento manifest: ${result.manifestChanged ? "sì" : "no"}`,
    `- immagini remote preservate: ${result.preservedRemoteAssets}`,
  ].join("\n"));
  write("\nNessuna immagine online verrà cancellata.\n");
}

function createProgressWriter(
  label: string,
  write: (message: string) => void,
): (progress: ProcessMediaProgress | UploadMediaProgress) => void {
  let lastPrinted = 0;
  return (progress) => {
    const interval = Math.max(1, Math.ceil(progress.total / 20));
    if (
      progress.completed !== 1
      && progress.completed !== progress.total
      && progress.completed - lastPrinted < interval
    ) {
      return;
    }
    lastPrinted = progress.completed;
    write(`${label}: ${progress.completed}/${progress.total} - ${progress.item}\n`);
  };
}

function defaultWrite(message: string): void {
  process.stdout.write(message);
}

async function missingConfirmation(): Promise<boolean> {
  throw new Error("La funzione di conferma non è disponibile.");
}
