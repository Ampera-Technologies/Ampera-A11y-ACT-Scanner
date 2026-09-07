import { describe, expect, it } from "vitest";
import {
  ARIA_VALUE_DESCRIPTORS,
  ariaValueError,
} from "./aria-value-validator";

describe("ACT-R19 ARIA value validation", () => {
  it("covers exactly the requested 50 attributes", () => {
    expect(Object.keys(ARIA_VALUE_DESCRIPTORS)).toHaveLength(50);
  });

  it.each([
    ["aria-atomic", "true"],
    ["aria-autocomplete", "both"],
    ["aria-checked", "mixed"],
    ["aria-checked", "undefined"],
    ["aria-expanded", "undefined"],
    ["aria-colcount", "-1"],
    ["aria-colindex", "1"],
    ["aria-colindextext", "Column one"],
    ["aria-controls", "menu help"],
    ["aria-hidden", "false"],
    ["aria-invalid", "grammar"],
    ["aria-level", "2"],
    ["aria-live", "polite"],
    ["aria-relevant", "additions text"],
    ["aria-rowindextext", "Row one"],
    ["aria-valuenow", "1.5"],
    ["aria-valuetext", "One and a half"],
  ])("accepts valid %s=%s", (attribute, value) => {
    expect(ariaValueError(attribute, value)).toBeNull();
  });

  it.each([
    ["aria-atomic", "mixed"],
    ["aria-autocomplete", "yes"],
    ["aria-colcount", "-2"],
    ["aria-colindex", "0"],
    ["aria-expanded", "mixed"],
    ["aria-hidden", "yes"],
    ["aria-invalid", "invalid"],
    ["aria-level", "1.5"],
    ["aria-live", "loud"],
    ["aria-rowspan", "0"],
    ["aria-selected", "mixed"],
    ["aria-valuenow", "12px"],
  ])("rejects invalid %s=%s", (attribute, value) => {
    expect(ariaValueError(attribute, value)).not.toBeNull();
  });

  it("treats absent-equivalent empty values as inapplicable", () => {
    expect(ariaValueError("aria-expanded", "")).toBeNull();
    expect(ariaValueError("aria-expanded", "   ")).toBeNull();
  });

  it("accepts every supported token in token lists", () => {
    expect(ariaValueError("aria-relevant", "all text")).toBeNull();
    expect(ariaValueError("aria-dropeffect", "none move")).toBeNull();
  });
});