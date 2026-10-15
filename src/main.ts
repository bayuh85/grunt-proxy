import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, resolveConfig, type CliArgs } from "./config.js";
import { loadEnvFile } from "./envfile.js";
import { Ledger, parseLedger, summarize } from "./ledger.js";
import { formatReport } from "./report.js";
import { startServer } from "./server.js";

export const HELP = `grunt-proxy — compress prompts, request terse replies, report savings

Usage
  grunt-proxy [--host 127.0.0.1] [--port 8642] [--level 2]
              [--terse auto|always|off]
              [--upstream https://atmorouter.dev/v1]
  grunt-proxy --report [ledger.jsonl]
  grunt-proxy --help

Clients
  OpenAI-compatible (Cursor, Cline, SDKs)   http://HOST:PORT/v1
  Anthropic SDK and Claude Code             http://HOST:PORT
                                            (they append /v1/messages)

Default upstream is https://atmorouter.dev/v1
Environment variables are listed in .env.example
Ctrl+C prints the savings report.
`;

export interface MainOptions {
  env?: NodeJS.ProcessEnv;
  envFile?: string;
}

export async function main(argv: readonly string[] = process.argv.slice(2), options: MainOptions = {}): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  const env = options.env ?? process.env;
  loadEnvFile(options.envFile ?? path.join(process.cwd(), ".env"), env);
  if (args.report !== undefined) {
    await printReport(env, args);
    return;
  }
  const config = resolveConfig(env, args);
  const ledger = new Ledger();
  const running = await startServer({ config, ledger });
  const auth = config.overrideKey ? "env key" : "forward client key";
  process.stderr.write(
    [
      `grunt-proxy  ${running.url}`,
      `upstream     ${config.upstreamBaseUrl}`,
      `compress     level ${config.level} · terse ${config.terse}`,
      `auth         ${auth}`,
      `savings      ${running.url}/savings`,
      "ctrl+c       print the savings report",
      "",
    ].join("\n"),
  );

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`\n${formatReport(ledger.summary())}\n`);
    running.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function printReport(env: NodeJS.ProcessEnv, args: CliArgs): Promise<void> {
  const config = resolveConfig(env, args);
  const file = args.report === true ? config.logFile : args.report;
  if (!file) throw new Error("No ledger file. Set GRUNT_LOG_FILE or pass --report <file>.");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not read ledger";
    throw new Error(`Could not read ledger ${file}: ${message}`);
  }
  process.stdout.write(`${formatReport(summarize(parseLedger(text)))}\n`);
}
