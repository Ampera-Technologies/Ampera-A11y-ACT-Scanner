import { describe, expect, it } from "vitest";
import { classifyR37Candidate } from "./media";

describe("ACT-R37 strict video alternative", () => {
  it("reports a potential issue when audio is confirmed and no strict alternative exists", () => {
    expect(classifyR37Candidate(false, false, false)).toBe("Potential Issue");
  });

  it("reports a potential issue when audio presence cannot be determined", () => {
    expect(classifyR37Candidate("unknown", false, false)).toBe("Potential Issue");
  });

  it("does not report confirmed-silent video under R37", () => {
    expect(classifyR37Candidate(true, false, false)).toBeNull();
  });

  it("does not report when either accepted alternative path exists", () => {
    expect(classifyR37Candidate(false, true, false)).toBeNull();
    expect(classifyR37Candidate("unknown", false, true)).toBeNull();
  });
});