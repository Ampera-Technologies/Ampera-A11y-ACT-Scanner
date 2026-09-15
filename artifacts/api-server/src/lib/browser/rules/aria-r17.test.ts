import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./aria.ts", import.meta.url), "utf8");

describe("ACT-R17 hidden focusable content guard", () => {
  it("checks every ancestor for CSS and HTML mechanisms that remove descendants from tab order", () => {
    expect(source).toContain('style.display === "none"');
    expect(source).toContain('style.visibility === "hidden"');
    expect(source).toContain('style.visibility === "collapse"');
    expect(source).toContain('node.hidden || node.hasAttribute("inert")');
    expect(source).toContain('contentVisibility === "hidden"');
    expect(source).toContain('node.matches("details:not([open])")');
    expect(source).toContain('if (!summary?.contains(el)) return false');
  });

  it("does not use aria-hidden as a reason to suppress its own applicability", () => {
    const helper = source.slice(source.indexOf("function isR17Tabbable"), source.indexOf("export function runAriaRules"));
    expect(helper).not.toContain('getAttribute("aria-hidden")');
  });
});