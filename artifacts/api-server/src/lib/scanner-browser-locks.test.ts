import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("scanner browser profile isolation guards", () => {
  it("does not sweep shared profile locks from getBrowser", () => {
    const source = readFileSync(new URL("./scanner.ts", import.meta.url), "utf8");
    const getBrowserStart = source.indexOf("async function getBrowser");
    const getBrowserEnd = source.indexOf("\nasync function", getBrowserStart + 1);
    const getBrowserSource = source.slice(
      getBrowserStart,
      getBrowserEnd === -1 ? source.length : getBrowserEnd,
    );

    expect(getBrowserSource).not.toContain("clearChromeLocks()");
    expect(getBrowserSource).toContain("puppeteerExtra.launch({ ...launchOptions, userDataDir })");
    expect(getBrowserSource).toContain("`session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`");
  });
});