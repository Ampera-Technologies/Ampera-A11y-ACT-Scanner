export const ISSUE_TYPES = [
  "content",
  "epic",
  "test",
  "task",
  "story",
  "request",
  "bug",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_WORKFLOWS: Record<IssueType, readonly string[]> = {
  content: [
    "todo",
    "in_progress",
    "deployed",
    "review",
    "release_to_retest",
    "reopen",
    "verified",
    "complete",
  ],
  epic: [
    "todo",
    "in_progress",
    "deployed",
    "review",
    "release_to_retest",
    "reopen",
    "verified",
    "complete",
  ],
  test: [
    "todo",
    "in_progress",
    "deployed",
    "review",
    "release_to_retest",
    "reopen",
    "verified",
    "complete",
  ],
  task: [
    "todo",
    "in_progress",
    "deployed",
    "review",
    "release_to_retest",
    "reopen",
    "verified",
    "complete",
  ],
  story: [
    "todo",
    "in_progress",
    "deployed",
    "review",
    "release_to_retest",
    "reopen",
    "verified",
    "complete",
  ],
  request: [
    "todo",
    "in_progress",
    "deployed",
    "review",
    "release_to_retest",
    "reopen",
    "verified",
    "complete",
  ],
  bug: [
    "todo",
    "in_progress",
    "fixed",
    "review",
    "release_to_retest",
    "reopen",
    "verified",
    "closed",
  ],
};

// These statuses branch from the main lifecycle rather than appearing in every
// workflow sequence. They must still be accepted by update validation.
const BRANCH_ISSUE_STATUSES = ["rejected", "blocked", "differ"] as const;

export const ALL_ISSUE_STATUSES = [
  ...new Set([
    ...Object.values(ISSUE_WORKFLOWS).flat(),
    ...BRANCH_ISSUE_STATUSES,
  ]),
];

const transitions: Record<IssueType, Record<string, readonly string[]>> = {
  content: {
    todo: ["in_progress"],
    in_progress: ["deployed", "blocked"],
    deployed: ["review"],
    blocked: ["in_progress"],
    review: ["release_to_retest"],
    release_to_retest: ["reopen", "verified"],
    reopen: ["in_progress"],
    verified: ["complete"],
    complete: ["reopen"],
  },
  epic: {
    todo: ["in_progress"],
    in_progress: ["deployed"],
    deployed: ["review"],
    blocked: ["in_progress"],
    review: ["release_to_retest"],
    release_to_retest: ["reopen", "verified"],
    reopen: ["in_progress"],
    verified: ["complete"],
    complete: ["reopen"],
  },
  test: {
    todo: ["in_progress"],
    in_progress: ["deployed", "blocked"],
    deployed: ["review"],
    blocked: ["in_progress"],
    review: ["release_to_retest"],
    release_to_retest: ["reopen", "verified"],
    reopen: ["in_progress"],
    verified: ["complete"],
    complete: ["reopen"],
  },
  task: {
    todo: ["in_progress"],
    in_progress: ["deployed", "blocked"],
    deployed: ["review"],
    blocked: ["in_progress"],
    review: ["release_to_retest"],
    release_to_retest: ["reopen", "verified"],
    reopen: ["in_progress"],
    verified: ["complete"],
    complete: ["reopen"],
  },
  story: {
    todo: ["in_progress"],
    in_progress: ["deployed", "blocked"],
    deployed: ["review"],
    blocked: ["in_progress"],
    review: ["release_to_retest"],
    release_to_retest: ["reopen", "verified"],
    reopen: ["in_progress"],
    verified: ["complete"],
    complete: ["reopen"],
  },
  request: {
    todo: ["in_progress"],
    in_progress: ["deployed", "blocked"],
    deployed: ["review"],
    blocked: ["in_progress"],
    review: ["release_to_retest"],
    release_to_retest: ["reopen", "verified"],
    reopen: ["in_progress"],
    verified: ["complete"],
    complete: ["reopen"],
  },
  bug: {
    todo: ["in_progress"],
    in_progress: ["fixed", "rejected", "blocked", "differ"],
    fixed: ["review"],
    rejected: ["in_progress"],
    blocked: ["in_progress"],
    differ: ["in_progress"],
    review: ["release_to_retest"],
    release_to_retest: ["reopen", "verified"],
    reopen: ["in_progress"],
    verified: ["closed"],
    closed: ["reopen"],
  },
};

export function isIssueType(value: unknown): value is IssueType {
  return typeof value === "string" && ISSUE_TYPES.includes(value as IssueType);
}

export function isIssueStatus(value: unknown): value is string {
  return typeof value === "string" && ALL_ISSUE_STATUSES.includes(value);
}

export function getAllowedIssueTransitions(
  type: IssueType,
  currentStatus: string,
): readonly string[] {
  return transitions[type][currentStatus] ?? [];
}

export function canTransitionIssue(
  type: IssueType,
  currentStatus: string,
  nextStatus: string,
): boolean {
  return (
    currentStatus === nextStatus ||
    getAllowedIssueTransitions(type, currentStatus).includes(nextStatus)
  );
}

export function terminalIssueStatus(type: IssueType): "complete" | "closed" {
  return type === "bug" ? "closed" : "complete";
}
