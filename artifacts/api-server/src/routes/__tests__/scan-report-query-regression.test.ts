import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("scan report query regression guards", () => {
  it("qualifies rule execution status columns after joining page results", () => {
    const source = readFileSync(new URL("../scans.ts", import.meta.url), "utf8");

    expect(source).toContain("SELECT rs.rule_id, rs.status, rs.execution_tier");
    expect(source).not.toContain("SELECT rule_id, status, execution_tier");
  });
});