import type { TerseMode } from "./types.js";

/** Developer short forms already common in prose. Applied at level 2+. */
export const GLOSSARY_LEVEL2: Readonly<Record<string, string>> = {
  function: "fn",
  functions: "fns",
  configuration: "config",
  configurations: "configs",
  implementation: "impl",
  implementations: "impls",
  parameter: "param",
  parameters: "params",
  argument: "arg",
  arguments: "args",
  information: "info",
  description: "desc",
  descriptions: "descs",
  documentation: "docs",
  application: "app",
  applications: "apps",
  database: "db",
  databases: "dbs",
  authentication: "auth",
  environment: "env",
  environments: "envs",
  directory: "dir",
  directories: "dirs",
  repository: "repo",
  repositories: "repos",
  initialize: "init",
  initialization: "init",
  temporary: "temp",
  previous: "prev",
  previously: "prev",
  request: "req",
  requests: "reqs",
  message: "msg",
  messages: "msgs",
  number: "num",
  numbers: "nums",
  boolean: "bool",
  asynchronous: "async",
  synchronous: "sync",
};

/** Level 3 adds shorter, lossier forms on top of level 2. */
export const GLOSSARY_LEVEL3_EXTRA: Readonly<Record<string, string>> = {
  between: "btwn",
  without: "w/o",
  with: "w/",
  and: "&",
  following: "foll",
  important: "key",
  example: "ex",
  examples: "exs",
  configuration: "cfg",
  configurations: "cfgs",
  approximately: "approx",
  standard: "std",
  additional: "extra",
  original: "orig",
};

export const GLOSSARY_LEVEL3: Readonly<Record<string, string>> = {
  ...GLOSSARY_LEVEL2,
  ...GLOSSARY_LEVEL3_EXTRA,
};

export const GRUNT_MARK = "[grunt]";

/** Auto mode adds the terse instruction on large prompts even when compression is modest. */
export const AUTO_TERSE_MIN_TOKENS = 800;

const BASE_DIRECTIVE =
  "[grunt] Reply in normal English, terse and exact. No greeting, no recap, no closing offer. Keep code, JSON, and tool calls complete and valid. Correctness beats brevity.";

const LEVEL2_HINT =
  "Short forms: fn function, config configuration, impl implementation, param parameter, arg argument, info information, docs documentation, app application, db database, auth authentication, env environment, dir directory, repo repository, init initialize, prev previous, req request, msg message, num number, async asynchronous.";

const LEVEL3_HINT =
  "Also cfg configuration, btwn between, w/o without, w/ with, & and, ex example, foll following.";

export function glossaryForLevel(level: number): Readonly<Record<string, string>> {
  if (level >= 3) return GLOSSARY_LEVEL3;
  if (level >= 2) return GLOSSARY_LEVEL2;
  return {};
}

/**
 * Stable for a given level so a provider prompt cache can reuse the prefix.
 * One paragraph, no blank line, so a second pass can keep it verbatim.
 */
export function directiveForLevel(level: number): string {
  if (level >= 3) {
    return `${BASE_DIRECTIVE} Input may drop filler, articles, and some function words. ${LEVEL2_HINT} ${LEVEL3_HINT} Recover the intent.`;
  }
  if (level >= 2) {
    return `${BASE_DIRECTIVE} Input may drop filler and articles. ${LEVEL2_HINT} Recover the intent.`;
  }
  return `${BASE_DIRECTIVE} Input may drop filler; recover the intent.`;
}

export function containsGruntDirective(text: string): boolean {
  return text.includes(GRUNT_MARK);
}

export function shouldRequestTerse(
  mode: TerseMode,
  originalTokens: number,
  savedTokens: number,
  directiveTokens: number,
): boolean {
  if (mode === "off") return false;
  if (mode === "always") return true;
  return savedTokens > directiveTokens || originalTokens >= AUTO_TERSE_MIN_TOKENS;
}
