import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runGuidedWorkflow } from "./guided";

async function main(): Promise<void> {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    await runGuidedWorkflow({
      cwd: process.cwd(),
      env: process.env,
      dependencies: {
        confirm: async (question) => {
          const answer = (await readline.question(question)).trim().toLowerCase();
          return answer === "s" || answer === "si" || answer === "sì";
        },
      },
    });
  } finally {
    readline.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nOPERAZIONE NON COMPLETATA\n${message}\n`);
  process.exitCode = 1;
});
