import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ACT-R14 label-in-name regression guards", () => {
  it("uses the visible-label resolver for every applicable control", () => {
    const source = readFileSync(new URL("./names.ts", import.meta.url), "utf8");

    expect(source).toContain("const rawVisible = getVisibleLabel(el)");
    expect(source).not.toContain('["combobox", "listbox"].includes(role)');
  });

  it("gives existing aria-labelledby targets priority over fallback labels", () => {
    const source = readFileSync(new URL("../accname.ts", import.meta.url), "utf8");
    const labelledByPosition = source.indexOf('const labelledBy = el.getAttribute("aria-labelledby")');
    const nativeFieldPosition = source.indexOf("el instanceof HTMLInputElement", labelledByPosition);

    expect(labelledByPosition).toBeGreaterThan(-1);
    expect(nativeFieldPosition).toBeGreaterThan(labelledByPosition);
    expect(source).toContain("document.getElementById(id)?.textContent?.trim()");
  });
});