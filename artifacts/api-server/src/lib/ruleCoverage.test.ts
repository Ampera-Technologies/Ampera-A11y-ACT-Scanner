import { describe, expect, it } from "vitest";
import { aggregateRuleCoverage, classifyScanConfidence } from "./ruleCoverage";

describe("rule execution coverage aggregation", () => {
  it("keeps selection, applicability, execution, manual, and failure counts distinct", () => {
    const result = aggregateRuleCoverage([
      { ruleId: "ACT-R1", executionTier: "automatic", status: "executed" },
      { ruleId: "ACT-R1", executionTier: "automatic", status: "not-applicable" },
      { ruleId: "ACT-R1", executionTier: "automatic", status: "failed" },
      { ruleId: "ACT-R1", executionTier: "automatic", status: "not-selected" },
      { ruleId: "ACT-R24", executionTier: "manual", status: "executed" },
      { ruleId: "ACT-R24", executionTier: "manual", status: "not-selected" },
    ], 4);
    expect(result.rules).toContainEqual({
      ruleId: "ACT-R1", selected: 3, notSelected: 1, notApplicable: 1,
      executed: 1, manual: 0, failed: 1, executionTier: "automatic",
    });
    expect(result.automaticApplicabilityCoverage).toBe(33.3);
    expect(result.rules.find((rule) => rule.ruleId === "ACT-R24")?.manual).toBe(1);
  });
});

describe("scan confidence", () => {
  it("explains incomplete pages, unresolved review, fallback denominators, and carry-forward", () => {
    const confidence = classifyScanConfidence({
      totalPages: 4,
      completedPages: 3,
      failedPages: 1,
      automaticApplicabilityCoverage: 75,
      manualUnresolved: 2,
      potentialUnresolved: 1,
      fallbackDenominatorPages: 1,
      carriedForwardPages: 2,
    });
    expect(confidence.classification).toBe("medium");
    expect(confidence.score).toBeGreaterThanOrEqual(70);
    expect(confidence.basis.join(" ")).toContain("fallback score denominator");
    expect(confidence.basis.join(" ")).toContain("carried evidence forward");
  });

  it("reports no evidence as unavailable", () => {
    expect(classifyScanConfidence({
      totalPages: 0, completedPages: 0, failedPages: 0,
      automaticApplicabilityCoverage: 0,
    })).toMatchObject({ classification: "unavailable", score: null });
  });
});