import type { RuleExecutionTier, RuleExecutionStatus } from "./browser/registry";

export type PersistedRuleStatus = RuleExecutionStatus & {
  carriedForward?: boolean;
};

export interface RuleCoverage {
  ruleId: string;
  selected: number;
  notSelected: number;
  notApplicable: number;
  executed: number;
  manual: number;
  failed: number;
  executionTier: RuleExecutionTier;
}

export interface ConfidenceSummary {
  classification: "high" | "medium" | "low" | "unavailable";
  score: number | null;
  basis: string[];
  completedPages: number;
  failedPages: number;
  automaticApplicabilityCoverage: number;
  manualUnresolved: number;
  potentialUnresolved: number;
  fallbackDenominatorPages: number;
  carriedForwardPages: number;
}

export function aggregateRuleCoverage(
  rows: readonly PersistedRuleStatus[],
  totalPages = 0,
): { rules: RuleCoverage[]; automaticApplicabilityCoverage: number } {
  const byRule = new Map<string, RuleCoverage>();
  for (const row of rows) {
    const current = byRule.get(row.ruleId) ?? {
      ruleId: row.ruleId,
      selected: 0,
      notSelected: 0,
      notApplicable: 0,
      executed: 0,
      manual: 0,
      failed: 0,
      executionTier: row.executionTier,
    };
    current.executionTier = row.executionTier;
    if (row.status === "not-selected") current.notSelected++;
    else {
      current.selected++;
      if (row.status === "not-applicable") current.notApplicable++;
      if (row.status === "executed") current.executed++;
      if (row.status === "failed") current.failed++;
      if (row.executionTier === "manual") current.manual++;
    }
    byRule.set(row.ruleId, current);
  }
  const rules = [...byRule.values()].sort((a, b) =>
    a.ruleId.localeCompare(b.ruleId, undefined, { numeric: true }),
  );
  const automatic = rules.filter((r) => r.executionTier === "automatic");
  const autoSelected = automatic.reduce((n, r) => n + r.selected, 0);
  const autoExecuted = automatic.reduce((n, r) => n + r.executed, 0);
  return {
    rules,
    automaticApplicabilityCoverage: autoSelected
      ? Math.round((autoExecuted / autoSelected) * 1000) / 10
      : totalPages === 0 ? 0 : 100,
  };
}

/**
 * Confidence is deliberately separate from the accessibility score. It says
 * how much of the requested work produced evidence, not whether the evidence
 * found violations. The basis is returned with the result so reports can
 * explain every classification.
 */
export function classifyScanConfidence(input: {
  totalPages: number;
  completedPages: number;
  failedPages: number;
  automaticApplicabilityCoverage: number;
  manualUnresolved?: number;
  potentialUnresolved?: number;
  fallbackDenominatorPages?: number;
  carriedForwardPages?: number;
}): ConfidenceSummary {
  const total = Math.max(0, input.totalPages);
  if (total === 0) {
    return {
      classification: "unavailable", score: null, basis: ["No pages were requested."],
      completedPages: 0, failedPages: 0, automaticApplicabilityCoverage: 0,
      manualUnresolved: input.manualUnresolved ?? 0, potentialUnresolved: input.potentialUnresolved ?? 0,
      fallbackDenominatorPages: input.fallbackDenominatorPages ?? 0,
      carriedForwardPages: input.carriedForwardPages ?? 0,
    };
  }
  const completion = Math.min(1, Math.max(0, input.completedPages / total));
  const auto = Math.min(1, Math.max(0, input.automaticApplicabilityCoverage / 100));
  const unresolved = (input.manualUnresolved ?? 0) + (input.potentialUnresolved ?? 0);
  const unresolvedRate = Math.min(1, unresolved / Math.max(1, total));
  const fallbackRate = Math.min(1, (input.fallbackDenominatorPages ?? 0) / total);
  const carriedRate = Math.min(1, (input.carriedForwardPages ?? 0) / total);
  const score = Math.round(Math.max(0, Math.min(100,
    completion * 45 + auto * 45 + (1 - unresolvedRate) * 5 +
    (1 - fallbackRate) * 3 + (carriedRate > 0 ? 2 : 0),
  )) * 10) / 10;
  const basis = [
    `${input.completedPages} of ${total} pages completed (${Math.round(completion * 100)}%).`,
    `Automatic rule applicability coverage is ${Math.round(input.automaticApplicabilityCoverage * 10) / 10}%.`,
  ];
  if (input.failedPages > 0) basis.push(`${input.failedPages} page${input.failedPages === 1 ? "" : "s"} failed or were unavailable.`);
  if (unresolved > 0) basis.push(`${unresolved} manual or potential review item${unresolved === 1 ? "" : "s"} remain unresolved.`);
  if ((input.fallbackDenominatorPages ?? 0) > 0) basis.push(`${input.fallbackDenominatorPages} page${input.fallbackDenominatorPages === 1 ? "" : "s"} used a fallback score denominator.`);
  if ((input.carriedForwardPages ?? 0) > 0) basis.push(`${input.carriedForwardPages} page${input.carriedForwardPages === 1 ? "" : "s"} carried evidence forward from an incremental scan.`);
  const classification = score >= 90 && input.failedPages === 0 && unresolved === 0
    ? "high"
    : score >= 70 ? "medium" : "low";
  return {
    classification, score, basis, completedPages: input.completedPages, failedPages: input.failedPages,
    automaticApplicabilityCoverage: input.automaticApplicabilityCoverage,
    manualUnresolved: input.manualUnresolved ?? 0, potentialUnresolved: input.potentialUnresolved ?? 0,
    fallbackDenominatorPages: input.fallbackDenominatorPages ?? 0, carriedForwardPages: input.carriedForwardPages ?? 0,
  };
}