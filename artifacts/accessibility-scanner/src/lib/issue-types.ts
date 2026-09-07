export const ISSUE_TYPES = [
  "task",
  "story",
  "bug",
  "epic",
  "content",
  "test",
  "request",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  fixed: "Fixed",
  deployed: "Deployed",
  review: "Review",
  release_to_retest: "Released to Retest",
  reopen: "Reopen",
  verified: "Verified",
  complete: "Complete",
  closed: "Closed",
  rejected: "Rejected",
  blocked: "Blocked",
  differ: "Differed",
};

export const TYPE_COLORS: Record<string, string> = {
  task: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  story:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  bug: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  epic: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  content:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  test: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  request:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
};

export const STATUS_COLORS: Record<string, string> = {
  todo: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  in_progress:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  fixed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  deployed: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  review:
    "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  release_to_retest:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  reopen: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  verified:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  complete:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  closed: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  blocked: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  rejected: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  differ: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export const BUG_TRANSITIONS: Record<string, string[]> = {
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
};

export const STANDARD_TRANSITIONS: Record<string, string[]> = {
  todo: ["in_progress"],
  in_progress: ["deployed", "blocked"],
  deployed: ["review"],
  blocked: ["in_progress"],
  review: ["release_to_retest"],
  release_to_retest: ["reopen", "verified"],
  reopen: ["in_progress"],
  verified: ["complete"],
  complete: ["reopen"],
};

export const EPIC_TRANSITIONS: Record<string, string[]> = {
  todo: ["in_progress"],
  in_progress: ["deployed"],
  deployed: ["review"],
  blocked: ["in_progress"],
  review: ["release_to_retest"],
  release_to_retest: ["reopen", "verified"],
  reopen: ["in_progress"],
  verified: ["complete"],
  complete: ["reopen"],
};

export function getStatusTransitions(type: string, status: string) {
  const transitions =
    type === "bug"
      ? BUG_TRANSITIONS
      : type === "epic"
        ? EPIC_TRANSITIONS
        : STANDARD_TRANSITIONS;
  return transitions[status] || [];
}

export const PRIORITIES = [
  "lowest",
  "low",
  "medium",
  "high",
  "highest",
] as const;
export const ISSUE_LINK_TYPES = [
  "parent",
  "child",
  "blocks",
  "blocked_by",
  "relates_to",
  "duplicates",
  "duplicated_by",
] as const;
export type IssueLinkType = (typeof ISSUE_LINK_TYPES)[number];

export const ISSUE_LINK_LABELS: Record<IssueLinkType, string> = {
  parent: "Parent of",
  child: "Child of",
  blocks: "Blocks",
  blocked_by: "Blocked by",
  relates_to: "Relates to",
  duplicates: "Duplicates",
  duplicated_by: "Duplicated by",
};

export interface IssueAttachment {
  id?: number;
  filename: string;
  contentType: string;
  size: number;
  objectPath: string;
}

export interface Issue {
  id: number;
  issueKey: string;
  type: IssueType;
  title: string;
  description: string;
  status: string;
  priority: string;

  // Bug fields
  severity?: string | null;
  environment?: string | null;
  stepsToReproduce?: string | null;
  expectedResult?: string | null;
  actualResult?: string | null;

  // Story fields
  acceptanceCriteria?: string | null;
  value?: string | null;

  // Task fields
  checklist?: { text: string; done: boolean }[];

  // Epic fields
  objective?: string | null;
  targetOutcome?: string | null;

  // Content fields
  audience?: string | null;
  channel?: string | null;
  publishTarget?: string | null;

  // Test fields
  scope?: string | null;

  // Request fields
  requestCategory?: string | null;
  impact?: string | null;

  // Source & Metadata
  siteId?: number | null;
  siteName?: string | null;
  projectId?: number | null;
  projectName?: string | null;
  scanId?: number | null;
  pageId?: number | null;
  ruleId?: string | null;
  selector?: string | null;
  sourceDescription?: string | null;

  assigneeId?: number | null;
  assigneeName?: string | null;
  reporterName?: string;
  labels: string[];
  epicId?: number | null;
  dueDate?: string | null;
  sprint?: string | null;
  customFields?: Record<string, any>;
  attachments?: IssueAttachment[];
  archived: boolean;

  createdAt: string;
  updatedAt: string;
}

export interface IssueMetrics {
  total: number;
  open: number;
  inProgress: number;
  done: number;
  bugs: number;
  statusCounts?: Record<string, number>;
  typeCounts?: Record<string, number>;
}

export interface IssueReference {
  id: number;
  issueKey: string;
  title: string;
  type: IssueType;
  status: string;
}

export interface IssueRelationship {
  id: number;
  linkType: IssueLinkType;
  issue: IssueReference;
}

export interface Comment {
  id: number;
  body: string;
  authorId: number;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  attachments?: IssueAttachment[];
}

export interface Activity {
  id: number;
  action: string;
  actorName: string;
  createdAt: string;
}

export interface IssueDetailData {
  issue: Issue;
  epic?: IssueReference | null;
  epicIssues?: IssueReference[];
  links?: IssueRelationship[];
  comments: Comment[];
  activity: Activity[];
  attachments?: IssueAttachment[];
}

export interface Person {
  id: number;
  name: string;
  email: string;
}
