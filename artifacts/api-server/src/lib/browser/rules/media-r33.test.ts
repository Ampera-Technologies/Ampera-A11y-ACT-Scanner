import { describe, expect, it } from "vitest";
import { isMediaReviewLabel, isSubstantiveMediaReviewText } from "./media";

describe("ACT-R33 media-alternative review text", () => {
  it("accepts a substantive nearby video description as a review candidate", () => {
    expect(
      isSubstantiveMediaReviewText(
        "Automatic subtitle generation recognizes speech and adds synchronized text to the video.",
      ),
    ).toBe(true);
  });

  it("ignores empty, decorative, and very short nearby text", () => {
    expect(isSubstantiveMediaReviewText("")).toBe(false);
    expect(isSubstantiveMediaReviewText("••••••••••••••••••••")).toBe(false);
    expect(isSubstantiveMediaReviewText("Watch now")).toBe(false);
  });

  it("accepts a descriptive video title as a manual-review candidate", () => {
    expect(isMediaReviewLabel("Instantly Generate")).toBe(true);
    expect(isMediaReviewLabel("Format your subtitles")).toBe(true);
  });

  it("ignores empty and generic video labels", () => {
    expect(isMediaReviewLabel("")).toBe(false);
    expect(isMediaReviewLabel("Video")).toBe(false);
    expect(isMediaReviewLabel("Play video")).toBe(false);
  });
});