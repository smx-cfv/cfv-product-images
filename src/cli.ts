import "dotenv/config";
import { processMedia } from "./media/process";
import { credentialsFromEnv, uploadMedia } from "./media/upload";
import { parsePositiveInteger } from "./media/utils";

interface CliOptions {
  command: string;
  pre?: string;
  limit?: number;
  concurrency?: number;
  dryRun?: boolean;
  confirm?: boolean;
  resume?: boolean;
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const cwd = process.cwd();
  const baseUrl = process.env.R2_BUCKET_DOMAIN || "https://img.cfvfilter.com";

  if (options.command === "media:process") {
    const result = await processMedia({
      cwd,
      baseUrl,
      pre: options.pre,
      limit: options.limit,
      concurrency: options.concurrency,
      dryRun: Boolean(options.dryRun),
      resume: Boolean(options.resume),
    });
    printJson(result);
    return;
  }

  if (options.command === "media:uploads") {
    const result = await uploadMedia({
      cwd,
      baseUrl,
      pre: options.pre,
      limit: options.limit,
      concurrency: options.concurrency,
      confirm: Boolean(options.confirm),
      credentials: credentialsFromEnv(process.env),
    });
    printJson(result);
    return;
  }

  throw new Error(`Unknown command: ${options.command}`);
}

function parseCli(args: string[]): CliOptions {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(command ? 0 : 1);
  }

  const options: CliOptions = { command };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") continue;
    const [flag, inlineValue] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const readValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      index += 1;
      return value;
    };

    switch (flag) {
      case "--pre":
        options.pre = readValue();
        break;
      case "--limit":
        options.limit = parsePositiveInteger(readValue(), "--limit");
        break;
      case "--concurrency":
        options.concurrency = parsePositiveInteger(readValue(), "--concurrency");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--confirm":
        options.confirm = true;
        break;
      case "--resume":
        options.resume = true;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  return options;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  process.stdout.write(`Usage:
  pnpm media:process -- --pre=MANN --limit=100 --resume --concurrency=4 --dry-run
  pnpm media:uploads -- --pre=MANN --limit=100 --confirm --concurrency=6

Upload is a dry-run unless --confirm is present.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
