#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { main } from "./main.js";

export { parseArgs, resolveConfig } from "./config.js";
export { compressText } from "./compress.js";
export { main } from "./main.js";
export { startServer } from "./server.js";

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
