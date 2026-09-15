export type ScanRawResult = {
  ruleId: string;
  type: string;
  /** Optional Siteimprove wording for rules with multiple questions under one ID. */
  displayTitle?: string;
  impact: string;
  description: string;
  element: string | null;
  elementContext?: string | null;
  selector: string | null;
};

export type PushStatFn = (ruleId: string, totalChecked: number, scope: "element" | "page") => void;

export type RuleExecutionStatus = import("./registry").RuleExecutionStatus;
