import { describe, expect, it } from "vitest";
import { classifyMissingCaptions } from "./media";

describe("ACT-R22 missing synchronized captions", () => {
  it("reports a confirmed issue when video audio is detected without captions", () => {
    expect(classifyMissingCaptions(true, false)).toBe("Issue");
  });

  it("reports a potential issue when audio cannot be determined", () => {
    expect(classifyMissingCaptions("unknown", false)).toBe("Potential Issue");
  });

  it("does not report captioned or confirmed-silent video", () => {
    expect(classifyMissingCaptions(true, true)).toBeNull();
    expect(classifyMissingCaptions("unknown", true)).toBeNull();
    expect(classifyMissingCaptions(false, false)).toBeNull();
  });
});