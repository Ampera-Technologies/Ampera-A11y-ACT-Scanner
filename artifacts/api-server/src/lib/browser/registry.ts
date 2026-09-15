/**
 * The browser rule registry is the single inventory used by both scan entry
 * points.  A detector is intentionally still kept in its existing module:
 * registry entries describe and select detectors, they do not reimplement
 * their checks.
 */
export type RuleExecutionTier = "automatic" | "manual";
export type RuleFamily =
  | "document"
  | "names"
  | "aria"
  | "media"
  | "headings-landmarks"
  | "links-contrast"
  | "tables-forms"
  | "text-style"
  | "structure"
  | "keyboard";
export type RuleRequirement =
  | "dom"
  | "computed-style"
  | "media-metadata"
  | "visual-background";

export interface RuleMetadata {
  id: string;
  family: RuleFamily;
  executionTier: RuleExecutionTier;
  /** Kept explicit so consumers do not infer reviewability from rule wording. */
  manual: boolean;
  requirements: readonly RuleRequirement[];
}

export type RuleExecutionStatus = {
  ruleId: string;
  status: "not-selected" | "not-applicable" | "executed" | "failed";
  executionTier: RuleExecutionTier;
};
export type RuleApplicabilityStat = {
  ruleId: string;
  totalChecked: number;
  scope: "element" | "page";
};

const familyRules: Record<RuleFamily, readonly string[]> = {
  document: ["ACT-R1", "ACT-R3", "ACT-R4", "ACT-R5", "ACT-R6", "ACT-R7", "ACT-R109", "ACT-R110", "ACT-R114"],
  names: ["ACT-R2", "ACT-R8", "ACT-R11", "ACT-R12", "ACT-R13", "ACT-R14", "ACT-R15", "ACT-R28", "ACT-R43", "ACT-R94", "ACT-R116"],
  aria: ["ACT-R10", "ACT-R16", "ACT-R17", "ACT-R18", "ACT-R19", "ACT-R20", "ACT-R21", "ACT-R36", "ACT-R40", "ACT-R42", "ACT-R86", "ACT-R90"],
  media: ["ACT-R9", "ACT-R22", "ACT-R23", "ACT-R24", "ACT-R25", "ACT-R26", "ACT-R27", "ACT-R29", "ACT-R30", "ACT-R31", "ACT-R32", "ACT-R33", "ACT-R35", "ACT-R37", "ACT-R38", "ACT-R47", "ACT-R48", "ACT-R50", "ACT-R51", "ACT-R52"],
  "headings-landmarks": ["ACT-R34", "ACT-R53", "ACT-R54", "ACT-R55", "ACT-R56", "ACT-R57", "ACT-R59", "ACT-R64", "ACT-R65", "ACT-R87", "ACT-R97", "ACT-R99", "ACT-R101", "ACT-R102"],
  "links-contrast": ["ACT-R39", "ACT-R41", "ACT-R44", "ACT-R66", "ACT-R69", "ACT-R81", "ACT-R88", "ACT-R89", "ACT-R113"],
  "tables-forms": ["ACT-R45", "ACT-R46", "ACT-R60", "ACT-R76", "ACT-R82", "ACT-R84", "ACT-R107"],
  "text-style": ["ACT-R62", "ACT-R67", "ACT-R70", "ACT-R71", "ACT-R72", "ACT-R73", "ACT-R74", "ACT-R75", "ACT-R80", "ACT-R83", "ACT-R85"],
  structure: ["ACT-R79", "ACT-R84", "ACT-R91", "ACT-R92", "ACT-R93", "ACT-R98", "ACT-R100", "ACT-R115", "ACT-R117", "ACT-R118", "ACT-R119", "ACT-R121", "ACT-R126", "ACT-R128"],
  keyboard: ["ACT-R49", "ACT-R61", "ACT-R63", "ACT-R68", "ACT-R77", "ACT-R78", "ACT-R95", "ACT-R96", "ACT-R111", "ACT-R112"],
};

const manualRuleIds = new Set([
  "ACT-R23", "ACT-R24", "ACT-R27",
  "ACT-R66", "ACT-R69", "ACT-R72", "ACT-R80", "ACT-R83", "ACT-R84", "ACT-R86",
  "ACT-R88", "ACT-R89", "ACT-R98", "ACT-R100", "ACT-R102", "ACT-R109",
  "ACT-R118", "ACT-R119", "ACT-R121",
]);
const visualRuleIds = new Set(["ACT-R66", "ACT-R69", "ACT-R88", "ACT-R89"]);
const mediaRuleIds = new Set(["ACT-R22", "ACT-R23", "ACT-R24", "ACT-R25", "ACT-R26", "ACT-R27", "ACT-R29", "ACT-R30", "ACT-R31", "ACT-R32", "ACT-R33", "ACT-R35", "ACT-R37", "ACT-R38", "ACT-R47", "ACT-R48", "ACT-R50", "ACT-R51"]);
const computedStyleRuleIds = new Set(["ACT-R44", "ACT-R49", "ACT-R62", "ACT-R67", "ACT-R70", "ACT-R71", "ACT-R72", "ACT-R73", "ACT-R74", "ACT-R75", "ACT-R78", "ACT-R80", "ACT-R81", "ACT-R83", "ACT-R85", "ACT-R91", "ACT-R92", "ACT-R93", "ACT-R113"]);

function requirementsFor(id: string): readonly RuleRequirement[] {
  const requirements: RuleRequirement[] = ["dom"];
  if (computedStyleRuleIds.has(id)) requirements.push("computed-style");
  if (mediaRuleIds.has(id)) requirements.push("media-metadata");
  if (visualRuleIds.has(id)) requirements.push("visual-background");
  return requirements;
}

const allEntries = Object.entries(familyRules).flatMap(([family, ids]) =>
  ids.map((id): RuleMetadata => ({
    id,
    family: family as RuleFamily,
    executionTier: manualRuleIds.has(id) ? "manual" : "automatic",
    manual: manualRuleIds.has(id),
    requirements: requirementsFor(id),
  })),
);

// ACT-R84 has two legacy detector meanings (scrollable content and links that
// open a new window). Keep one metadata record while retaining both families
// for selection and execution.
const entries = [...new Map(allEntries.map((entry) => [entry.id, entry])).values()];
export const RULE_REGISTRY: readonly RuleMetadata[] = entries;
const metadataById = new Map(entries.map((entry) => [entry.id, entry]));
const familiesByRuleId = new Map<string, RuleFamily[]>();
for (const [family, ids] of Object.entries(familyRules) as [RuleFamily, readonly string[]][]) {
  for (const id of ids) {
    const families = familiesByRuleId.get(id) ?? [];
    families.push(family);
    familiesByRuleId.set(id, families);
  }
}

/** Rule output has two legacy aliases (ACT-R84(link), etc.). */
export function normalizeRuleId(ruleId: string): string {
  return ruleId.trim().toUpperCase().replace(/\([^)]*\)$/, "");
}

export function getSelectedRuleIds(rules?: readonly string[]): Set<string> | null {
  if (!rules || rules.length === 0) return null;
  return new Set(rules.map(normalizeRuleId).filter(Boolean));
}

export function isRuleSelected(ruleId: string, selected: Set<string> | null): boolean {
  return selected === null || selected.has(normalizeRuleId(ruleId));
}

export function isFamilySelected(family: RuleFamily, selected: Set<string> | null): boolean {
  return selected === null || familyRules[family].some((id) => selected.has(id));
}

export function hasManualRuleSelected(selected: Set<string> | null): boolean {
  return selected !== null && [...selected].some((id) => metadataById.get(id)?.manual === true);
}

export function isManualRule(ruleId: string): boolean {
  return metadataById.get(normalizeRuleId(ruleId))?.manual === true;
}

export function getRuleExecutionStatuses(
  selected: Set<string> | null,
  executedFamilies: ReadonlySet<RuleFamily>,
  stats: readonly RuleApplicabilityStat[] = [],
): RuleExecutionStatus[] {
  const ids = selected ? new Set([...metadataById.keys(), ...selected]) : new Set(metadataById.keys());
  const statsByRuleId = new Map<string, RuleApplicabilityStat>();
  for (const stat of stats) {
    const normalizedId = normalizeRuleId(stat.ruleId);
    const existing = statsByRuleId.get(normalizedId);
    if (!existing || stat.totalChecked > existing.totalChecked || stat.scope === "page") {
      statsByRuleId.set(normalizedId, { ...stat, ruleId: normalizedId });
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((ruleId) => {
    const metadata = metadataById.get(ruleId);
    const applicability = statsByRuleId.get(ruleId);
    const isApplicable = applicability
      ? applicability.totalChecked > 0 || applicability.scope === "page"
      : false;
    return {
      ruleId,
      status: selected !== null && !selected.has(ruleId)
        ? "not-selected"
        : metadata && isApplicable &&
            (familiesByRuleId.get(ruleId) ?? []).some((family) => executedFamilies.has(family))
          ? "executed"
          : "not-applicable",
      executionTier: metadata?.executionTier ?? "automatic",
    };
  });
}

/** Reconcile copied evidence to the current canonical registry and selection. */
export function reconcileRuleExecutionStatuses(
  previous: readonly RuleExecutionStatus[],
  selected: Set<string> | null,
): RuleExecutionStatus[] {
  const canonical = getRuleExecutionStatuses(selected, new Set())
    .filter((status) => metadataById.has(status.ruleId));
  const prior = new Map(previous.map((status) => [normalizeRuleId(status.ruleId), status]));
  return canonical.map((status) => {
    const priorStatus = prior.get(status.ruleId);
    return (selected === null || selected.has(status.ruleId)) && priorStatus
      ? { ...status, status: priorStatus.status }
      : status;
  });
}
