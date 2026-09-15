// ════════════════════════════════════════════════════════════════════════════
// Ampera Accessibility Scanner — Browser Bundle
//
// This file is compiled by esbuild to an IIFE (dist/browser-bundle.js) and
// injected into Puppeteer pages via page.addScriptTag().  All code here runs
// inside Chromium — NOT in Node.js.
//
// Exposes:  window.__ampera = { runAllRules }
// ════════════════════════════════════════════════════════════════════════════

export type { ScanRawResult } from "./types";
import type { PushStatFn } from "./types";
import {
  LANGUAGE_DETECTOR_BUILD_MARKER,
  runDocumentLanguageRules,
  verifyLanguageDetectorBundle,
} from "./rules/document-language";
import { runNamesRules } from "./rules/names";
import { runAriaRules } from "./rules/aria";
import { runMediaRules } from "./rules/media";
import { runHeadingsLandmarksRules } from "./rules/headings-landmarks";
import { runLinksContrastRules } from "./rules/links-contrast";
import { runTablesFormsRules } from "./rules/tables-forms";
import { runTextStyleRules } from "./rules/text-style";
import { runStructureMiscRules } from "./rules/structure-misc";
import { runKeyboardMiscRules } from "./rules/keyboard-misc";
import {
  getRuleExecutionStatuses,
  getSelectedRuleIds,
  hasManualRuleSelected,
  isFamilySelected,
  isRuleSelected,
  isManualRule,
  type RuleFamily,
} from "./registry";

// Legacy callers may continue to use options: { emitManualOnlyRules?: boolean } = {}.
function runAllRules(
  options: { emitManualOnlyRules?: boolean; rules?: string[] } = {},
): {
  issues: import("./types").ScanRawResult[];
  stats: { ruleId: string; totalChecked: number; scope: "element" | "page" }[];
  ruleStatuses: import("./types").RuleExecutionStatus[];
} {
  const results: import("./types").ScanRawResult[] = [];
  const selected = getSelectedRuleIds(options.rules);
  const executedFamilies = new Set<RuleFamily>();
  // Siteimprove/Alfa parity: rules Alfa classifies as "can't tell" (manual
  // review) are never auto-reported by the Siteimprove checker. Keeping the
  // detection code gated by default preserves that behavior. The API can
  // explicitly enable this tier for a scan that selected a manual-only rule.
  const EMIT_MANUAL_ONLY_RULES =
    options.emitManualOnlyRules === true || hasManualRuleSelected(selected);

  // Accumulate totalChecked per rule — some rules call pushStat multiple times
  // with the same ruleId (e.g. R14 checks two element sets); we add them up.
  const statMap = new Map<string, { totalChecked: number; scope: "element" | "page" }>();
  const pushStat: PushStatFn = (ruleId, totalChecked, scope) => {
    if (!isRuleSelected(ruleId, selected)) return;
    const existing = statMap.get(ruleId);
    if (existing) {
      existing.totalChecked += totalChecked;
    } else {
      statMap.set(ruleId, { totalChecked, scope });
    }
  };

  const runFamily = (family: RuleFamily, run: () => void) => {
    if (!isFamilySelected(family, selected)) return;
    executedFamilies.add(family);
    run();
  };
  runFamily("document", () => runDocumentLanguageRules(results, EMIT_MANUAL_ONLY_RULES, pushStat));
  runFamily("names", () => runNamesRules(results, pushStat));
  runFamily("aria", () => runAriaRules(results, EMIT_MANUAL_ONLY_RULES, pushStat));
  runFamily("media", () => runMediaRules(results, EMIT_MANUAL_ONLY_RULES, pushStat));
  runFamily("headings-landmarks", () => runHeadingsLandmarksRules(results, EMIT_MANUAL_ONLY_RULES, pushStat));
  runFamily("links-contrast", () => runLinksContrastRules(results, EMIT_MANUAL_ONLY_RULES, pushStat));
  runFamily("tables-forms", () => runTablesFormsRules(results, pushStat));
  runFamily("text-style", () => runTextStyleRules(results, EMIT_MANUAL_ONLY_RULES, pushStat));
  runFamily("structure", () => runStructureMiscRules(results, EMIT_MANUAL_ONLY_RULES, pushStat));
  runFamily("keyboard", () => runKeyboardMiscRules(results, EMIT_MANUAL_ONLY_RULES, pushStat));

  const stats = Array.from(statMap.entries()).map(([ruleId, s]) => ({
    ruleId,
    totalChecked: s.totalChecked,
    scope: s.scope,
  }));

  return {
    issues: results.filter((issue) => isRuleSelected(issue.ruleId, selected)),
    stats,
    ruleStatuses: getRuleExecutionStatuses(selected, executedFamilies, stats).map((status) =>
      !EMIT_MANUAL_ONLY_RULES && isManualRule(status.ruleId)
        ? { ...status, status: "not-applicable" as const }
        : status,
    ),
  };
}

// ─── Expose on window for Puppeteer injection ─────────────────────────────────
(window as any).__ampera = {
  runAllRules,
  verifyLanguageDetectorBundle,
  buildMarkers: [LANGUAGE_DETECTOR_BUILD_MARKER],
};
