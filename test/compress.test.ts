import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compressDetailed, compressText, MIN_CHARS } from "../src/compress.js";
import { directiveForLevel } from "../src/glossary.js";

const FENCE = "```ts\nconst the = 1;\nfunction configuration() { return the; }\n```";

describe("compressText", () => {
  it("leaves short text and level 0 unchanged", () => {
    const tiny = "please remove this";
    assert.ok(tiny.length < MIN_CHARS);
    assert.equal(compressText(tiny, 2), tiny);
    const long = "Could you please explain the configuration parameter in the application environment? Thank you!";
    assert.ok(long.length >= MIN_CHARS);
    assert.equal(compressText(long, 0), long);
  });

  it("drops openers and courtesy at level 1 without abbreviating", () => {
    const input =
      "Could you please refactor this module in order to support the new configuration parameter? Thank you so much!";
    const out = compressText(input, 1);
    assert.ok(out.length < input.length);
    assert.doesNotMatch(out, /please/i);
    assert.doesNotMatch(out, /thank you/i);
    assert.doesNotMatch(out, /in order/i);
    assert.match(out, /to support/);
    assert.match(out, /configuration/);
  });

  it("abbreviates prose and keeps fenced code at level 2", () => {
    const input = [
      "Could you please update the configuration parameter in the application environment?",
      "Write a function that returns the previous information. Thank you!",
      "",
      FENCE,
      "",
    ].join("\n");
    const out = compressText(input, 2);
    assert.ok(out.includes(FENCE));
    assert.match(out, /\bconfig\b/);
    assert.match(out, /\bparam\b/);
    assert.match(out, /\bfn\b/);
    assert.match(out, /\bprev\b/);
    assert.match(out, /\binfo\b/);
    assert.doesNotMatch(out, /\bconfiguration\b/);
    assert.doesNotMatch(out, /\bplease\b/i);
    assert.ok(out.length < input.length);
  });

  it("keeps inline code, urls, paths, and camelCase identifiers", () => {
    const input =
      "Please keep `the configuration` while updating the configuration parameter in src/app/config.ts and see https://atmorouter.dev/docs. The previousValue identifier must stay in the application environment.";
    const out = compressText(input, 2);
    assert.ok(out.includes("`the configuration`"));
    assert.ok(out.includes("https://atmorouter.dev/docs"));
    assert.ok(out.includes("src/app/config.ts"));
    assert.ok(out.includes("previousValue"));
    assert.match(out, /\bconfig\b/);
  });

  it("keeps indented code lines", () => {
    const input =
      "Please update the configuration parameter for the application environment.\n    const the = configuration;\nThen initialize the repository.\n";
    const out = compressText(input, 2);
    assert.ok(out.includes("    const the = configuration;"));
    assert.match(out, /\brepo\b/);
  });

  it("does not abbreviate inside JSON payloads", () => {
    const json = JSON.stringify({
      note: "please keep the previous configuration information for the application environment",
    });
    assert.equal(compressText(json, 3), json);
  });

  it("does not rewrite a protected grunt directive", () => {
    const directive = directiveForLevel(2);
    const body = `${directive}\n\nPlease update the configuration parameter for the application environment today.`;
    const once = compressDetailed(body, 2);
    const twice = compressText(once.text, 2);
    assert.ok(once.text.startsWith(directive));
    assert.equal(twice, once.text);
    assert.doesNotMatch(once.text.split("\n\n")[1] ?? "", /\bconfiguration\b/);
  });

  it("uses heavier short forms at level 3", () => {
    const input =
      "Please compare the configuration between the application and the original standard without the additional example and with the following notes for the environment.";
    const out = compressText(input, 3);
    assert.match(out, /\bcfg\b/);
    assert.match(out, /\bbtwn\b/);
    assert.match(out, /w\/o/);
    assert.doesNotMatch(out, /\bconfiguration\b/);
  });
});
