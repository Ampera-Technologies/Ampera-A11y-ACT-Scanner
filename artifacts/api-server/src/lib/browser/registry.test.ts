import { describe, expect, it } from "vitest";
import {
  RULE_REGISTRY,
  getRuleExecutionStatuses,
  getSelectedRuleIds,
  reconcileRuleExecutionStatuses,
  isFamilySelected,
  isRuleSelected,
} from "./registry";

describe("browser rule registry", () => {
  it("normalizes explicit selections and preserves legacy rule aliases", () => {
    const selected = getSelectedRuleIds([" act-r84(link) ", "ACT-R66"]);
    expect(selected).toEqual(new Set(["ACT-R84", "ACT-R66"]));
    expect(isRuleSelected("ACT-R84(link)", selected)).toBe(true);
    expect(isRuleSelected("ACT-R81", selected)).toBe(false);
    expect(isFamilySelected("links-contrast", selected)).toBe(true);
    expect(isFamilySelected("media", selected)).toBe(false);
  });

  it("runs the media family when ACT-R22 is the only selected rule", () => {
    const selected = getSelectedRuleIds(["ACT-R22"]);
    expect(isFamilySelected("media", selected)).toBe(true);
    expect(RULE_REGISTRY.find((rule) => rule.id === "ACT-R22")).toMatchObject({
      family: "media",
      executionTier: "automatic",
      requirements: ["dom", "media-metadata"],
    });
  });

  it("reports selected, skipped, and unavailable rules without changing issue shape", () => {
    const selected = getSelectedRuleIds(["ACT-R24", "ACT-R999"]);
    const statuses = getRuleExecutionStatuses(selected, new Set(["media"]), [
      { ruleId: "ACT-R24", totalChecked: 1, scope: "element" },
    ]);
    expect(statuses.find((status) => status.ruleId === "ACT-R24")).toMatchObject({
      status: "executed",
      executionTier: "manual",
    });
    expect(statuses.find((status) => status.ruleId === "ACT-R66")?.status).toBe(
      "not-selected",
    );
    expect(statuses.find((status) => status.ruleId === "ACT-R999")).toMatchObject({
      status: "not-applicable",
    });
  });

  it("derives applicability from per-rule stats, including page-scope checks", () => {
    const selected = getSelectedRuleIds(["ACT-R1", "ACT-R2", "ACT-R3"]);
    const statuses = getRuleExecutionStatuses(selected, new Set(["document", "names"]), [
      { ruleId: "ACT-R1", totalChecked: 0, scope: "page" },
      { ruleId: "ACT-R2", totalChecked: 0, scope: "element" },
    ]);
    expect(statuses.find((status) => status.ruleId === "ACT-R1")?.status).toBe(
      "executed",
    );
    expect(statuses.find((status) => status.ruleId === "ACT-R2")?.status).toBe(
      "not-applicable",
    );
    expect(statuses.find((status) => status.ruleId === "ACT-R3")?.status).toBe(
      "not-applicable",
    );

    const manualStatuses = getRuleExecutionStatuses(
      getSelectedRuleIds(["ACT-R24"]),
      new Set(["media"]),
      [],
    );
    expect(manualStatuses.find((status) => status.ruleId === "ACT-R24")).toMatchObject({
      ruleId: "ACT-R24",
      executionTier: "manual",
      status: "not-applicable",
    });
  });

  it("gives every registered rule an execution tier and family", () => {
    expect(RULE_REGISTRY.length).toBeGreaterThan(100);
    expect(RULE_REGISTRY.every((rule) => rule.id.startsWith("ACT-R"))).toBe(true);
    expect(RULE_REGISTRY.every((rule) => rule.requirements.includes("dom"))).toBe(
      true,
    );
  });

  it("reconciles carried evidence to changed selections and drops unknown IDs", () => {
    const reconciled = reconcileRuleExecutionStatuses(
      [
        { ruleId: "ACT-R24", status: "executed", executionTier: "manual" },
        { ruleId: "ACT-R999", status: "executed", executionTier: "automatic" },
      ],
      getSelectedRuleIds(["ACT-R1"]),
    );
    expect(reconciled.find((status) => status.ruleId === "ACT-R24")?.status).toBe("not-selected");
    expect(reconciled.find((status) => status.ruleId === "ACT-R1")?.status).toBe("not-applicable");
    expect(reconciled.some((status) => status.ruleId === "ACT-R999")).toBe(false);
  });
});
