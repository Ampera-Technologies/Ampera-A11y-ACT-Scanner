import { describe, expect, it } from "vitest";
import { findDuplicateLandmarkNames } from "./headings-landmarks";

describe("ACT-R56 duplicate landmark names", () => {
  it("reports every unnamed landmark when the same role occurs more than once", () => {
    const landmarks = [
      { id: "header-one", role: "banner", name: "" },
      { id: "primary-nav", role: "navigation", name: "" },
      { id: "header-two", role: "banner", name: "" },
      { id: "footer-nav", role: "navigation", name: "" },
      { id: "footer", role: "contentinfo", name: "" },
    ];

    const duplicates = findDuplicateLandmarkNames(landmarks);
    expect(duplicates.map((group) => group.map(({ id }) => id))).toEqual([
      ["header-one", "header-two"],
      ["primary-nav", "footer-nav"],
    ]);
  });

  it("normalizes case and whitespace while keeping different roles separate", () => {
    const landmarks = [
      { id: "nav-one", role: "navigation", name: " Main menu " },
      { id: "nav-two", role: "navigation", name: "main   MENU" },
      { id: "banner", role: "banner", name: "Main menu" },
      { id: "nav-three", role: "navigation", name: "Footer links" },
    ];

    expect(
      findDuplicateLandmarkNames(landmarks).map((group) =>
        group.map(({ id }) => id),
      ),
    ).toEqual([["nav-one", "nav-two"]]);
  });
});