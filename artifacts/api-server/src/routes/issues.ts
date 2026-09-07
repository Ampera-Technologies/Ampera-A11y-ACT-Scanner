import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import {
  db, appIssuesTable, appIssueCommentsTable, appIssueActivityTable, appIssueAttachmentsTable, appIssueLinksTable,
  usersTable, sitesTable, projectsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/authMiddleware";
import { canAccessSite, getEffectivePermissions } from "../lib/permissions";
import {
  ALL_ISSUE_STATUSES,
  ISSUE_TYPES,
  canTransitionIssue,
  isIssueStatus,
  isIssueType,
  type IssueType,
} from "../lib/issue-workflow";
import {
  AttachmentStorageConfigurationError,
  IssueAttachmentStorageService,
} from "../lib/issueAttachmentStorage";
import {
  canonicalizeIssueLink,
  isIssueLinkType,
  relationshipIdentity,
  wouldCreateParentCycle,
  type IssueLinkType,
} from "../lib/issue-relations";
import { notifyIssueEvent, splitCommentRecipientIds } from "../lib/issue-notifications";

const router: IRouter = Router();
export const ISSUE_CREATE_ROUTE_MARKER = "issues-create-route-v1";
export const ISSUE_ATTACHMENT_ROUTE_MARKER = "issues-attachments-r2-v1";
const statuses = ALL_ISSUE_STATUSES;
const priorities = ["lowest", "low", "medium", "high", "highest"];
const issueAttachmentStorage = new IssueAttachmentStorageService();
const issueColumns = {
  id: appIssuesTable.id, issueKey: appIssuesTable.issueKey, type: appIssuesTable.type, title: appIssuesTable.title,
  description: appIssuesTable.description, status: appIssuesTable.status, priority: appIssuesTable.priority, severity: appIssuesTable.severity,
  projectId: appIssuesTable.projectId, siteId: appIssuesTable.siteId, scanId: appIssuesTable.scanId, pageId: appIssuesTable.pageId,
  ruleId: appIssuesTable.ruleId, selector: appIssuesTable.selector, sourceDescription: appIssuesTable.sourceDescription,
  assigneeId: appIssuesTable.assigneeId, reporterId: appIssuesTable.reporterId, labels: appIssuesTable.labels, checklist: appIssuesTable.checklist,
  acceptanceCriteria: appIssuesTable.acceptanceCriteria, environment: appIssuesTable.environment, stepsToReproduce: appIssuesTable.stepsToReproduce,
  expectedResult: appIssuesTable.expectedResult, actualResult: appIssuesTable.actualResult, dueDate: appIssuesTable.dueDate, sprint: appIssuesTable.sprint,
  relatedIssueIds: appIssuesTable.relatedIssueIds, epicId: appIssuesTable.epicId, customFields: appIssuesTable.customFields,
  archived: appIssuesTable.archived, createdAt: appIssuesTable.createdAt, updatedAt: appIssuesTable.updatedAt,
};
const issueLinkColumns = {
  id: appIssueLinksTable.id, sourceIssueId: appIssueLinksTable.sourceIssueId, targetIssueId: appIssueLinksTable.targetIssueId,
  linkType: appIssueLinksTable.linkType, createdBy: appIssueLinksTable.createdBy, createdAt: appIssueLinksTable.createdAt,
};
const issueCommentColumns = {
  id: appIssueCommentsTable.id, issueId: appIssueCommentsTable.issueId, authorId: appIssueCommentsTable.authorId,
  body: appIssueCommentsTable.body, mentions: appIssueCommentsTable.mentions, createdAt: appIssueCommentsTable.createdAt, updatedAt: appIssueCommentsTable.updatedAt,
};
const issueActivityColumns = {
  id: appIssueActivityTable.id, issueId: appIssueActivityTable.issueId, actorId: appIssueActivityTable.actorId,
  action: appIssueActivityTable.action, details: appIssueActivityTable.details, createdAt: appIssueActivityTable.createdAt,
};
const issueAttachmentColumns = {
  id: appIssueAttachmentsTable.id, issueId: appIssueAttachmentsTable.issueId, commentId: appIssueAttachmentsTable.commentId,
  uploadedBy: appIssueAttachmentsTable.uploadedBy, objectPath: appIssueAttachmentsTable.objectPath, filename: appIssueAttachmentsTable.filename,
  contentType: appIssueAttachmentsTable.contentType, size: appIssueAttachmentsTable.size, pending: appIssueAttachmentsTable.pending,
  expiresAt: appIssueAttachmentsTable.expiresAt, createdAt: appIssueAttachmentsTable.createdAt,
};
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
const ACCEPTED_ATTACHMENT_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm",
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/csv",
]);

async function hasIssuePermission(req: any, permission: "canViewIssues" | "canCreateIssue" | "canEditIssue" | "canCommentIssue" | "canManageIssues") {
  const user = req.session!.user;
  const permissions = await getEffectivePermissions(Number(user.id), user.role);
  return permissions[permission];
}

async function requireIssuePermission(req: any, res: any, permission: "canViewIssues" | "canCreateIssue" | "canEditIssue" | "canCommentIssue" | "canManageIssues") {
  if (await hasIssuePermission(req, permission)) return true;
  res.status(403).json({ error: "You do not have permission to use this issue feature" });
  return false;
}

async function canUploadIssueAttachment(req: any) {
  return (await hasIssuePermission(req, "canEditIssue")) || (await hasIssuePermission(req, "canCommentIssue"));
}

async function visibleWhere(_req: any) {
  // Issue visibility is workspace-wide for users who pass canViewIssues.
  // Keep this separate from site access: site access still controls whether
  // a user may create or associate an issue with a specific site.
  return sql`TRUE`;
}

async function canSeeIssue(req: any, id: number) {
  const [issue] = await db.select(issueColumns).from(appIssuesTable).where(and(eq(appIssuesTable.id, id), await visibleWhere(req))).limit(1);
  return issue;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function visibleIssueSummaries(req: any, ids: number[]) {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!uniqueIds.length) return [];
  return db.select({
    id: appIssuesTable.id,
    issueKey: appIssuesTable.issueKey,
    title: appIssuesTable.title,
    type: appIssuesTable.type,
    status: appIssuesTable.status,
  }).from(appIssuesTable).where(and(
    await visibleWhere(req),
    eq(appIssuesTable.archived, false),
    inArray(appIssuesTable.id, uniqueIds),
  ));
}

async function validateEpicAssignment(req: any, issueType: IssueType, epicId: number | null, issueId?: number): Promise<string | null> {
  if (!epicId) return null;
  if (issueType === "epic") return "Epic issues cannot belong to another Epic";
  if (issueId && issueId === epicId) return "An issue cannot be its own Epic";
  const epic = await canSeeIssue(req, epicId);
  if (!epic || epic.archived || epic.type !== "epic") return "Choose an Epic that you can access";
  return null;
}

function inverseLinkType(linkType: IssueLinkType): IssueLinkType {
  const inverse: Record<IssueLinkType, IssueLinkType> = {
    parent: "child",
    child: "parent",
    blocks: "blocked_by",
    blocked_by: "blocks",
    relates_to: "relates_to",
    duplicates: "duplicated_by",
    duplicated_by: "duplicates",
  };
  return inverse[linkType];
}

function cleanBody(body: any) {
  const value = (key: string, fallback: string | null = null) => typeof body?.[key] === "string" ? body[key].trim() : fallback;
  const richValue = (key: string) => {
    const field = value(key);
    return field === null ? null : sanitizeRichText(field);
  };
  return {
    type: isIssueType(body?.type) ? body.type : "task",
    title: value("title", "") ?? "",
    description: sanitizeRichText(value("description", "") ?? ""),
    status: typeof body?.status === "string" ? body.status.trim() : "todo",
    priority: priorities.includes(body?.priority) ? body.priority : "medium",
    severity: value("severity"),
    projectId: Number.isInteger(Number(body?.projectId)) && Number(body.projectId) > 0 ? Number(body.projectId) : null,
    siteId: Number.isInteger(Number(body?.siteId)) && Number(body.siteId) > 0 ? Number(body.siteId) : null,
    scanId: Number.isInteger(Number(body?.scanId)) && Number(body.scanId) > 0 ? Number(body.scanId) : null,
    pageId: Number.isInteger(Number(body?.pageId)) && Number(body.pageId) > 0 ? Number(body.pageId) : null,
    ruleId: value("ruleId"), selector: value("selector"), sourceDescription: value("sourceDescription"),
    assigneeId: Number.isInteger(Number(body?.assigneeId)) && Number(body.assigneeId) > 0 ? Number(body.assigneeId) : null,
    labels: Array.isArray(body?.labels) ? body.labels.filter((x: unknown) => typeof x === "string").slice(0, 20) : [],
    checklist: Array.isArray(body?.checklist) ? body.checklist.filter((x: any) => x && typeof x.text === "string").map((x: any) => ({ text: x.text.slice(0, 300), done: Boolean(x.done) })) : [],
    acceptanceCriteria: richValue("acceptanceCriteria"), environment: value("environment"),
    stepsToReproduce: richValue("stepsToReproduce"), expectedResult: richValue("expectedResult"), actualResult: richValue("actualResult"),
    dueDate: value("dueDate"), sprint: value("sprint"),
    relatedIssueIds: Array.isArray(body?.relatedIssueIds) ? body.relatedIssueIds.filter((x: unknown) => Number.isInteger(x)) : [],
    epicId: positiveInteger(body?.epicId),
    customFields: cleanCustomFields(body?.customFields),
  };
}

function cleanCustomFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => /^[a-z][a-zA-Z0-9_]{0,48}$/.test(key) && typeof item === "string")
    .slice(0, 20)
    .map(([key, item]) => [key, String(item).trim().slice(0, 1_500)]));
}

function sanitizeRichText(input: string): string {
  const allowedTags = new Set(["p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "a", "code", "pre", "blockquote", "h3", "h4", "table", "thead", "tbody", "tfoot", "tr", "th", "td"]);
  return input.slice(0, 50_000)
    .replace(/<!--[\s\S]*?-->|<(script|style|iframe|object|embed|svg|math)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(\/?)([a-z0-9]+)(?:\s[^>]*)?>/gi, (tag, closing: string, name: string) => {
      const tagName = name.toLowerCase();
      if (!allowedTags.has(tagName)) return "";
      if (closing) return `</${tagName}>`;
      if (tagName !== "a") return `<${tagName}>`;
      const href = tag.match(/\bhref\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? "";
      return /^(https?:|mailto:)/i.test(href) ? `<a href="${href.replace(/"/g, "%22")}">` : "<a>";
    });
}

function sanitizeIssueRichTextFields<T extends Record<string, any>>(issue: T): T {
  return {
    ...issue,
    description: sanitizeRichText(issue.description ?? ""),
    acceptanceCriteria: issue.acceptanceCriteria ? sanitizeRichText(issue.acceptanceCriteria) : issue.acceptanceCriteria,
    stepsToReproduce: issue.stepsToReproduce ? sanitizeRichText(issue.stepsToReproduce) : issue.stepsToReproduce,
    expectedResult: issue.expectedResult ? sanitizeRichText(issue.expectedResult) : issue.expectedResult,
    actualResult: issue.actualResult ? sanitizeRichText(issue.actualResult) : issue.actualResult,
  };
}

function plainRichText(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanMentionIds(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id) => Number.isInteger(Number(id)) && Number(id) > 0).map(Number))].slice(0, 25)
    : [];
}

function cleanAttachmentMetadata(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const objectPath = typeof item.objectPath === "string" ? item.objectPath : "";
  const filename = typeof item.filename === "string" ? item.filename.replace(/[\/\\]/g, "_").trim().slice(0, 255) : "";
  const contentType = typeof item.contentType === "string" ? item.contentType : "";
  const size = Number(item.size);
  const supportedObjectPath =
    objectPath.startsWith("/objects/") ||
    objectPath.startsWith("/azure-objects/") ||
    objectPath.startsWith("/r2-objects/");
  if (!supportedObjectPath || !filename || !ACCEPTED_ATTACHMENT_TYPES.has(contentType) || !Number.isInteger(size) || size <= 0 || size > MAX_ATTACHMENT_SIZE) return null;
  return { objectPath, filename, contentType, size };
}

async function saveAttachments(issueId: number, userId: number, attachments: unknown, commentId?: number) {
  const clean = Array.isArray(attachments) ? attachments.map(cleanAttachmentMetadata).filter(Boolean).slice(0, 8) : [];
  if (Array.isArray(attachments) && attachments.length > 0 && clean.length === 0) {
    throw new Error("Attachment metadata is invalid");
  }
  if (!clean.length) return [];
  const paths = clean.map((attachment) => attachment!.objectPath);
  const pending = await db.select(issueAttachmentColumns).from(appIssueAttachmentsTable).where(and(
    eq(appIssueAttachmentsTable.issueId, issueId),
    eq(appIssueAttachmentsTable.uploadedBy, userId),
    eq(appIssueAttachmentsTable.pending, true),
    gt(appIssueAttachmentsTable.expiresAt, new Date()),
    inArray(appIssueAttachmentsTable.objectPath, paths),
  ));
  if (pending.length !== paths.length) throw new Error("Attachment upload was not issued for this user and issue");
  for (const attachment of pending) await issueAttachmentStorage.verifyObject(attachment.objectPath, attachment.size);
  const saved = await Promise.all(pending.map(async (attachment) => {
    const [updated] = await db.update(appIssueAttachmentsTable)
      .set({ commentId: commentId ?? null, pending: false, expiresAt: null })
      .where(and(eq(appIssueAttachmentsTable.id, attachment.id), eq(appIssueAttachmentsTable.pending, true)))
      .returning();
    if (!updated) throw new Error("Attachment has already been consumed");
    return updated;
  }));
  return saved;
}

router.get("/issues/people", requireAuth, async (_req, res) => {
  if (!(await requireIssuePermission(_req, res, "canViewIssues"))) return;
  const people = await db.select({ id: usersTable.id, name: usersTable.fullName, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.isActive, true)).orderBy(asc(usersTable.fullName));
  res.json(people);
});

router.get("/issues", requireAuth, async (req, res) => {
  if (!(await requireIssuePermission(req, res, "canViewIssues"))) return;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const siteId = Number(req.query.siteId);
  const includeArchived = req.query.includeArchived === "true";
  if (includeArchived && req.session!.user!.role !== "super_admin" && !(await requireIssuePermission(req, res, "canManageIssues"))) return;
  const conditions = [await visibleWhere(req)];
  if (!includeArchived) conditions.push(eq(appIssuesTable.archived, false));
  if (q) conditions.push(or(ilike(appIssuesTable.title, `%${q}%`), ilike(appIssuesTable.issueKey, `%${q}%`), ilike(appIssuesTable.description, `%${q}%`))!);
  if (statuses.includes(String(req.query.status))) conditions.push(eq(appIssuesTable.status, String(req.query.status)));
  if (isIssueType(String(req.query.type))) conditions.push(eq(appIssuesTable.type, String(req.query.type)));
  if (Number.isInteger(siteId) && siteId > 0) conditions.push(eq(appIssuesTable.siteId, siteId));
  const issues = await db.select({
    issue: {
      id: appIssuesTable.id,
      issueKey: appIssuesTable.issueKey,
      type: appIssuesTable.type,
      title: appIssuesTable.title,
      description: appIssuesTable.description,
      status: appIssuesTable.status,
      priority: appIssuesTable.priority,
      severity: appIssuesTable.severity,
      projectId: appIssuesTable.projectId,
      siteId: appIssuesTable.siteId,
      scanId: appIssuesTable.scanId,
      pageId: appIssuesTable.pageId,
      ruleId: appIssuesTable.ruleId,
      selector: appIssuesTable.selector,
      sourceDescription: appIssuesTable.sourceDescription,
      assigneeId: appIssuesTable.assigneeId,
      reporterId: appIssuesTable.reporterId,
      labels: appIssuesTable.labels,
      checklist: appIssuesTable.checklist,
      acceptanceCriteria: appIssuesTable.acceptanceCriteria,
      environment: appIssuesTable.environment,
      stepsToReproduce: appIssuesTable.stepsToReproduce,
      expectedResult: appIssuesTable.expectedResult,
      actualResult: appIssuesTable.actualResult,
      dueDate: appIssuesTable.dueDate,
      sprint: appIssuesTable.sprint,
      relatedIssueIds: appIssuesTable.relatedIssueIds,
      epicId: appIssuesTable.epicId,
      customFields: appIssuesTable.customFields,
      archived: appIssuesTable.archived,
      createdAt: appIssuesTable.createdAt,
      updatedAt: appIssuesTable.updatedAt,
    },
    reporterName: sql<string | null>`(SELECT full_name FROM users WHERE users.id = ${appIssuesTable.reporterId})`,
    assigneeName: sql<string | null>`(SELECT full_name FROM users WHERE users.id = ${appIssuesTable.assigneeId})`,
    siteName: sitesTable.name,
    projectName: projectsTable.name,
  }).from(appIssuesTable)
    .leftJoin(sitesTable, eq(sitesTable.id, appIssuesTable.siteId))
    .leftJoin(projectsTable, eq(projectsTable.id, appIssuesTable.projectId))
    .where(and(...conditions)).orderBy(desc(appIssuesTable.updatedAt));
  const activeIssues = issues.filter((x) => !x.issue.archived);
  const metrics = {
    total: activeIssues.length,
    open: activeIssues.filter((x) => !["complete", "closed"].includes(x.issue.status)).length,
    inProgress: activeIssues.filter((x) => x.issue.status === "in_progress").length,
    done: activeIssues.filter((x) => ["complete", "closed"].includes(x.issue.status)).length,
    bugs: activeIssues.filter((x) => x.issue.type === "bug").length,
    statusCounts: Object.fromEntries(
      statuses.map((status) => [
        status,
        activeIssues.filter((x) => x.issue.status === status).length,
      ]),
    ),
    typeCounts: Object.fromEntries(
      ISSUE_TYPES.map((type) => [
        type,
        activeIssues.filter((x) => x.issue.type === type).length,
      ]),
    ),
  };
  res.json({ issues: issues.map((x) => ({ ...x.issue, reporterName: x.reporterName, assigneeName: x.assigneeName, siteName: x.siteName, projectName: x.projectName })), metrics });
});

router.post("/issues", requireAuth, async (req, res) => {
  if (!(await requireIssuePermission(req, res, "canCreateIssue"))) return;
  const data = { ...cleanBody(req.body), status: "todo" };
  if (!data.title || data.title.length > 300) { res.status(400).json({ error: "A title is required (max 300 characters)" }); return; }
  const epicError = await validateEpicAssignment(req, data.type, data.epicId);
  if (epicError) { res.status(400).json({ error: epicError }); return; }
  if (data.siteId && !(await canAccessSite(Number(req.session!.user!.id), String(req.session!.user!.id), req.session!.user!.role, data.siteId))) {
    res.status(403).json({ error: "You do not have access to this site" }); return;
  }
  const userId = Number(req.session!.user!.id);
  const [created] = await db.insert(appIssuesTable).values({ ...data, issueKey: "PENDING", reporterId: userId }).returning();
  const issueKey = `AMP-${String(created.id).padStart(4, "0")}`;
  const [issue] = await db.update(appIssuesTable).set({ issueKey }).where(eq(appIssuesTable.id, created.id)).returning();
  await db.insert(appIssueActivityTable).values({ issueId: issue.id, actorId: userId, action: "created", details: { title: issue.title } });
  if (issue.assigneeId) {
    await notifyIssueEvent({
      event: "assigned",
      issue,
      actorId: userId,
      candidateRecipientIds: [issue.assigneeId],
    });
  }
  res.status(201).json(issue);
});

router.get("/issues/:id", requireAuth, async (req, res) => {
  if (!(await requireIssuePermission(req, res, "canViewIssues"))) return;
  const issue = await canSeeIssue(req, Number(req.params.id));
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  const [comments, attachments, rawLinks, epicIssues] = await Promise.all([
    db.select({ comment: issueCommentColumns, authorName: usersTable.fullName }).from(appIssueCommentsTable)
      .innerJoin(usersTable, eq(usersTable.id, appIssueCommentsTable.authorId)).where(eq(appIssueCommentsTable.issueId, issue.id)).orderBy(asc(appIssueCommentsTable.createdAt)),
    db.select(issueAttachmentColumns).from(appIssueAttachmentsTable).where(eq(appIssueAttachmentsTable.issueId, issue.id)).orderBy(asc(appIssueAttachmentsTable.createdAt)),
    db.select(issueLinkColumns).from(appIssueLinksTable).where(or(
      eq(appIssueLinksTable.sourceIssueId, issue.id),
      eq(appIssueLinksTable.targetIssueId, issue.id),
    )),
    db.select({
      id: appIssuesTable.id,
      issueKey: appIssuesTable.issueKey,
      title: appIssuesTable.title,
      type: appIssuesTable.type,
      status: appIssuesTable.status,
    }).from(appIssuesTable).where(and(
      await visibleWhere(req),
      eq(appIssuesTable.archived, false),
      eq(appIssuesTable.epicId, issue.id),
    )),
  ]);
  const activity = await db.select({ event: issueActivityColumns, actorName: usersTable.fullName }).from(appIssueActivityTable)
    .innerJoin(usersTable, eq(usersTable.id, appIssueActivityTable.actorId)).where(eq(appIssueActivityTable.issueId, issue.id)).orderBy(desc(appIssueActivityTable.createdAt));
  const toAttachment = (attachment: typeof attachments[number]) => ({
    ...attachment,
    url: `/api/issues/${issue.id}/attachments/${attachment.id}`,
  });
  const relatedIssueIds = [
    ...(issue.epicId ? [issue.epicId] : []),
    ...rawLinks.map((link) => link.sourceIssueId === issue.id ? link.targetIssueId : link.sourceIssueId),
  ];
  const relationshipIssues = await visibleIssueSummaries(req, relatedIssueIds);
  const relationshipIssueById = new Map(relationshipIssues.map((related) => [related.id, related]));
  const links = rawLinks.flatMap((link) => {
    const otherIssueId = link.sourceIssueId === issue.id ? link.targetIssueId : link.sourceIssueId;
    const relatedIssue = relationshipIssueById.get(otherIssueId);
    if (!relatedIssue || !isIssueLinkType(link.linkType)) return [];
    return [{
      id: link.id,
      linkType: link.sourceIssueId === issue.id ? link.linkType : inverseLinkType(link.linkType),
      issue: relatedIssue,
    }];
  });
  res.json({
    issue: sanitizeIssueRichTextFields(issue),
    epic: issue.epicId ? relationshipIssueById.get(issue.epicId) ?? null : null,
    epicIssues,
    links,
    attachments: attachments.filter((attachment) => !attachment.pending && attachment.commentId === null).map(toAttachment),
    comments: comments.map((x) => ({
      ...x.comment,
      body: sanitizeRichText(x.comment.body),
      authorName: x.authorName,
      attachments: attachments.filter((attachment) => !attachment.pending && attachment.commentId === x.comment.id).map(toAttachment),
    })),
    activity: activity.map((x) => {
      const details = x.event.details && typeof x.event.details === "object" && !Array.isArray(x.event.details)
        ? Object.fromEntries(Object.entries(x.event.details as Record<string, unknown>).filter(([key]) => key !== "targetIssueId"))
        : x.event.details;
      return { ...x.event, details, actorName: x.actorName };
    }),
  });
});

router.patch("/issues/:id", requireAuth, async (req, res) => {
  if (!(await requireIssuePermission(req, res, "canEditIssue"))) return;
  const issue = await canSeeIssue(req, Number(req.params.id));
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  const data = cleanBody({ ...issue, ...req.body });
  if (!data.title) { res.status(400).json({ error: "A title is required" }); return; }
  if (data.type !== issue.type) { res.status(400).json({ error: "An issue's type cannot be changed after creation" }); return; }
  const epicError = await validateEpicAssignment(req, issue.type as IssueType, data.epicId, issue.id);
  if (epicError) { res.status(400).json({ error: epicError }); return; }
  if (data.siteId && !(await canAccessSite(Number(req.session!.user!.id), String(req.session!.user!.id), req.session!.user!.role, data.siteId))) {
    res.status(403).json({ error: "You do not have access to this site" }); return;
  }
  if (!isIssueStatus(data.status)) { res.status(400).json({ error: "Unknown issue status" }); return; }
  if (!canTransitionIssue(issue.type as IssueType, issue.status, data.status)) {
    res.status(400).json({ error: `The issue cannot move directly from ${issue.status} to ${data.status}` }); return;
  }
  const [updated] = await db.update(appIssuesTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(appIssuesTable.id, issue.id))
    .returning();
  await db.insert(appIssueActivityTable).values({
    issueId: issue.id,
    actorId: Number(req.session!.user!.id),
    action: data.status !== issue.status ? `moved from ${issue.status} to ${data.status}` : "updated",
    details: { fields: Object.keys(req.body ?? {}) },
  });
  const actorId = Number(req.session!.user!.id);
  const assigneeChanged = updated.assigneeId !== issue.assigneeId;
  if (assigneeChanged && updated.assigneeId) {
    await notifyIssueEvent({
      event: "assigned",
      issue: updated,
      actorId,
      candidateRecipientIds: [updated.assigneeId],
    });
  }
  if (updated.status !== issue.status) {
    await notifyIssueEvent({
      event: "status_changed",
      issue: updated,
      actorId,
      candidateRecipientIds: [updated.reporterId, updated.assigneeId]
        .filter((id): id is number => id !== null),
      previousStatus: issue.status,
    });
  }
  res.json(updated);
});

router.post("/issues/:id/links", requireAuth, async (req, res) => {
  if (!(await requireIssuePermission(req, res, "canEditIssue"))) return;
  const issue = await canSeeIssue(req, Number(req.params.id));
  const targetIssueId = positiveInteger(req.body?.targetIssueId);
  const linkType = req.body?.linkType;
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  if (!targetIssueId || !isIssueLinkType(linkType)) {
    res.status(400).json({ error: "Choose an issue and a supported relationship type" });
    return;
  }
  if (targetIssueId === issue.id) { res.status(400).json({ error: "An issue cannot link to itself" }); return; }
  const target = await canSeeIssue(req, targetIssueId);
  if (!target || target.archived) { res.status(404).json({ error: "The linked issue is not available" }); return; }

  const proposedLink = { sourceIssueId: issue.id, targetIssueId, linkType };
  const canonicalLink = canonicalizeIssueLink(proposedLink);
  const result = await db.transaction(async (tx) => {
    // Serializes relationship writes so concurrent hierarchy edits cannot form a cycle.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(289105)`);
    const rawExistingLinks = await tx.select(issueLinkColumns).from(appIssueLinksTable);
    const existingLinks = rawExistingLinks.filter((link) => isIssueLinkType(link.linkType)).map((link) => ({
      sourceIssueId: link.sourceIssueId,
      targetIssueId: link.targetIssueId,
      linkType: link.linkType as IssueLinkType,
    }));
    const proposedIdentity = relationshipIdentity(linkType, issue.id, targetIssueId);
    if (existingLinks.some((link) => relationshipIdentity(link.linkType, link.sourceIssueId, link.targetIssueId) === proposedIdentity)) {
      return { error: "duplicate" as const };
    }
    if (wouldCreateParentCycle(existingLinks, proposedLink)) {
      return { error: "cycle" as const };
    }
    const [created] = await tx.insert(appIssueLinksTable).values({
      ...canonicalLink,
      createdBy: Number(req.session!.user!.id),
    }).returning();
    return { created };
  });
  if ("error" in result) {
    res.status(result.error === "duplicate" ? 409 : 400).json({
      error: result.error === "duplicate" ? "That relationship already exists" : "This parent-child relationship would create a cycle",
    });
    return;
  }
  await db.update(appIssuesTable).set({ updatedAt: new Date() }).where(eq(appIssuesTable.id, issue.id));
  await db.insert(appIssueActivityTable).values({
    issueId: issue.id,
    actorId: Number(req.session!.user!.id),
    action: `linked as ${linkType.replace(/_/g, " ")}`,
    details: { linkType },
  });
  res.status(201).json({
    id: result.created.id,
    linkType,
    issue: { id: target.id, issueKey: target.issueKey, title: target.title, type: target.type, status: target.status },
  });
});

router.delete("/issues/:id/links/:linkId", requireAuth, async (req, res) => {
  if (!(await requireIssuePermission(req, res, "canEditIssue"))) return;
  const issue = await canSeeIssue(req, Number(req.params.id));
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  const [link] = await db.select(issueLinkColumns).from(appIssueLinksTable).where(and(
    eq(appIssueLinksTable.id, Number(req.params.linkId)),
    or(eq(appIssueLinksTable.sourceIssueId, issue.id), eq(appIssueLinksTable.targetIssueId, issue.id)),
  )).limit(1);
  if (!link) { res.status(404).json({ error: "Relationship not found" }); return; }
  const otherIssueId = link.sourceIssueId === issue.id ? link.targetIssueId : link.sourceIssueId;
  if (!(await canSeeIssue(req, otherIssueId))) { res.status(404).json({ error: "Relationship not found" }); return; }
  await db.delete(appIssueLinksTable).where(eq(appIssueLinksTable.id, link.id));
  await db.update(appIssuesTable).set({ updatedAt: new Date() }).where(eq(appIssuesTable.id, issue.id));
  await db.insert(appIssueActivityTable).values({
    issueId: issue.id,
    actorId: Number(req.session!.user!.id),
    action: "removed issue relationship",
    details: { linkId: link.id },
  });
  res.status(204).send();
});

router.post("/issues/:id/attachments/upload-url", requireAuth, async (req, res) => {
  if (!(await requireIssuePermission(req, res, "canViewIssues"))) return;
  const issue = await canSeeIssue(req, Number(req.params.id));
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  if (!(await canUploadIssueAttachment(req))) { res.status(403).json({ error: "You do not have permission to upload issue evidence" }); return; }
  const attachment = cleanAttachmentMetadata({ ...req.body, objectPath: "/objects/pending" });
  if (!attachment) { res.status(400).json({ error: "Use a supported image, video, or document no larger than 50 MB." }); return; }
  try {
    const prepared = await issueAttachmentStorage.prepareUpload(attachment.contentType);
    const { uploadURL, objectPath, uploadHeaders } = prepared;
    const [pending] = await db.insert(appIssueAttachmentsTable).values({
      issueId: issue.id,
      uploadedBy: Number(req.session!.user!.id),
      ...attachment,
      objectPath,
      pending: true,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    }).returning();
    const responseAttachment = { id: pending.id, objectPath, filename: pending.filename, contentType: pending.contentType, size: pending.size };
    const clientUploadURL = uploadURL ?? `/api/issues/${issue.id}/attachments/${pending.id}/upload`;
    res.json({ uploadURL: clientUploadURL, uploadHeaders, attachment: responseAttachment, objectPath });
  } catch (error) {
    (req as any).log?.error({ err: error }, "Unable to prepare issue attachment upload");
    const configurationError = error instanceof AttachmentStorageConfigurationError;
    res.status(configurationError ? 503 : 500).json({
      error: configurationError ? error.message : "Unable to prepare the attachment upload.",
    });
  }
});

router.put("/issues/:issueId/attachments/:attachmentId/upload", requireAuth, async (req, res) => {
  if (!(await requireIssuePermission(req, res, "canViewIssues"))) return;
  const issue = await canSeeIssue(req, Number(req.params.issueId));
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  if (!(await canUploadIssueAttachment(req))) { res.status(403).json({ error: "You do not have permission to upload issue evidence" }); return; }
  const userId = Number(req.session!.user!.id);
  const [pending] = await db.select(issueAttachmentColumns).from(appIssueAttachmentsTable).where(and(
    eq(appIssueAttachmentsTable.id, Number(req.params.attachmentId)),
    eq(appIssueAttachmentsTable.issueId, issue.id),
    eq(appIssueAttachmentsTable.uploadedBy, userId),
    eq(appIssueAttachmentsTable.pending, true),
    gt(appIssueAttachmentsTable.expiresAt, new Date()),
  )).limit(1);
  const isServerProxiedObject = pending?.objectPath.startsWith("/azure-objects/") || pending?.objectPath.startsWith("/r2-objects/");
  if (!pending || !isServerProxiedObject) {
    res.status(404).json({ error: "Pending attachment upload not found" });
    return;
  }
  const contentLength = Number(req.headers["content-length"]);
  const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim();
  if (contentLength !== pending.size || contentType !== pending.contentType) {
    res.status(400).json({ error: "Attachment size or content type does not match the upload request" });
    return;
  }
  try {
    await issueAttachmentStorage.uploadObject(pending.objectPath, req, pending.size, pending.contentType);
    res.status(204).end();
  } catch (error) {
    (req as any).log?.error({ err: error }, "Unable to upload issue attachment to object storage");
    res.status(502).json({ error: "Unable to store the attachment in object storage." });
  }
});

router.post("/issues/:id/attachments/confirm", requireAuth, async (req, res) => {
  if (!(await requireIssuePermission(req, res, "canViewIssues"))) return;
  const issue = await canSeeIssue(req, Number(req.params.id));
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  if (!(await canUploadIssueAttachment(req))) { res.status(403).json({ error: "You do not have permission to upload issue evidence" }); return; }
  const userId = Number(req.session!.user!.id);
  try {
    const attachments = await saveAttachments(issue.id, userId, req.body?.attachments);
    if (!attachments.length) { res.status(400).json({ error: "At least one uploaded file is required." }); return; }
    await db.update(appIssuesTable).set({ updatedAt: new Date() }).where(eq(appIssuesTable.id, issue.id));
    await db.insert(appIssueActivityTable).values({
      issueId: issue.id,
      actorId: userId,
      action: "attached files",
      details: { attachmentCount: attachments.length },
    });
    res.status(201).json({
      attachments: attachments.map((attachment) => ({
        ...attachment,
        url: `/api/issues/${issue.id}/attachments/${attachment.id}`,
      })),
    });
  } catch (error) {
    (req as any).log?.warn({ err: error }, "Unable to verify issue attachment upload");
    res.status(400).json({ error: "One or more uploaded files could not be verified." });
  }
});

router.get("/issues/:issueId/attachments/:attachmentId", requireAuth, async (req, res) => {
  if (!(await requireIssuePermission(req, res, "canViewIssues"))) return;
  const issue = await canSeeIssue(req, Number(req.params.issueId));
  if (!issue) { res.status(404).end(); return; }
  const [attachment] = await db.select(issueAttachmentColumns).from(appIssueAttachmentsTable)
    .where(and(eq(appIssueAttachmentsTable.id, Number(req.params.attachmentId)), eq(appIssueAttachmentsTable.issueId, issue.id), eq(appIssueAttachmentsTable.pending, false))).limit(1);
  if (!attachment) { res.status(404).end(); return; }
  try {
    const response = await issueAttachmentStorage.downloadObject(attachment.objectPath, attachment.contentType);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Disposition", `inline; filename="${attachment.filename.replace(/"/g, "")}"`);
    if (response.body) {
      const { Readable } = await import("stream");
      Readable.fromWeb(response.body as any).pipe(res);
    } else res.end();
  } catch {
    res.status(404).end();
  }
});

router.post("/issues/:id/comments", requireAuth, async (req, res) => {
  if (!(await requireIssuePermission(req, res, "canCommentIssue"))) return;
  const issue = await canSeeIssue(req, Number(req.params.id));
  const body = sanitizeRichText(typeof req.body?.body === "string" ? req.body.body : "");
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  const hasAttachments = Array.isArray(req.body?.attachments) && req.body.attachments.length > 0;
  if (!plainRichText(body) && !hasAttachments) { res.status(400).json({ error: "Comment cannot be empty" }); return; }
  const userId = Number(req.session!.user!.id);
  const mentions = cleanMentionIds(req.body?.mentionIds);
  const [comment] = await db.insert(appIssueCommentsTable).values({ issueId: issue.id, authorId: userId, body, mentions }).returning();
  let attachments;
  try {
    attachments = await saveAttachments(issue.id, userId, req.body?.attachments, comment.id);
  } catch {
    await db.delete(appIssueCommentsTable).where(eq(appIssueCommentsTable.id, comment.id));
    res.status(400).json({ error: "One or more uploaded files could not be verified." });
    return;
  }
  await db.update(appIssuesTable).set({ updatedAt: new Date() }).where(eq(appIssuesTable.id, issue.id));
  await db.insert(appIssueActivityTable).values({ issueId: issue.id, actorId: userId, action: "commented", details: { mentions, attachmentCount: attachments.length } });
  const commentExcerpt = plainRichText(body).slice(0, 240);
  const commentRecipients = splitCommentRecipientIds(issue, userId, mentions);
  if (commentRecipients.mentioned.length > 0) {
    await notifyIssueEvent({
      event: "mentioned",
      issue,
      actorId: userId,
      candidateRecipientIds: commentRecipients.mentioned,
      commentExcerpt,
      commentBody: plainRichText(body),
    });
  }
  if (commentRecipients.commented.length > 0) {
    await notifyIssueEvent({
      event: "commented",
      issue,
      actorId: userId,
      candidateRecipientIds: commentRecipients.commented,
      commentExcerpt,
      commentBody: plainRichText(body),
    });
  }
  const [author] = await db.select({ authorName: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, userId));
  res.status(201).json({ ...comment, authorName: author?.authorName, attachments: attachments.map((attachment) => ({ ...attachment, url: `/api/issues/${issue.id}/attachments/${attachment.id}` })) });
});

router.patch("/issues/:issueId/comments/:commentId", requireAuth, async (req, res) => {
  if (!(await requireIssuePermission(req, res, "canCommentIssue"))) return;
  const issueId = Number(req.params.issueId);
  const commentId = Number(req.params.commentId);
  const issue = await canSeeIssue(req, issueId);
  if (!issue || !Number.isInteger(commentId)) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const [comment] = await db.select(issueCommentColumns).from(appIssueCommentsTable).where(and(
    eq(appIssueCommentsTable.id, commentId),
    eq(appIssueCommentsTable.issueId, issue.id),
  ));
  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const userId = Number(req.session!.user!.id);
  if (comment.authorId !== userId) {
    res.status(403).json({ error: "You can only edit your own comments" });
    return;
  }

  const body = sanitizeRichText(typeof req.body?.body === "string" ? req.body.body : "");
  if (!plainRichText(body)) {
    res.status(400).json({ error: "Comment cannot be empty" });
    return;
  }

  const mentions = cleanMentionIds(req.body?.mentionIds);
  const updatedAt = new Date();
  const [updatedComment] = await db.update(appIssueCommentsTable)
    .set({ body, mentions, updatedAt })
    .where(eq(appIssueCommentsTable.id, comment.id))
    .returning();
  await Promise.all([
    db.update(appIssuesTable).set({ updatedAt }).where(eq(appIssuesTable.id, issue.id)),
    db.insert(appIssueActivityTable).values({
      issueId: issue.id,
      actorId: userId,
      action: "edited a comment",
      details: { commentId: comment.id },
    }),
  ]);

  res.json(updatedComment);
});

router.delete("/issues/:id", requireAuth, async (req, res) => {
  if (req.session!.user!.role !== "super_admin" && !(await requireIssuePermission(req, res, "canManageIssues"))) return;
  const issue = await canSeeIssue(req, Number(req.params.id));
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  await db.update(appIssuesTable).set({ archived: true, updatedAt: new Date() }).where(eq(appIssuesTable.id, issue.id));
  res.status(204).send();
});

router.post("/issues/:id/restore", requireAuth, async (req, res) => {
  if (req.session!.user!.role !== "super_admin" && !(await requireIssuePermission(req, res, "canManageIssues"))) return;
  const issue = await canSeeIssue(req, Number(req.params.id));
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  if (!issue.archived) { res.status(400).json({ error: "Issue is not archived" }); return; }
  const updatedAt = new Date();
  const [restored] = await db.update(appIssuesTable)
    .set({ archived: false, updatedAt })
    .where(eq(appIssuesTable.id, issue.id))
    .returning();
  await db.insert(appIssueActivityTable).values({
    issueId: issue.id,
    actorId: Number(req.session!.user!.id),
    action: "restored",
    details: {},
  });
  res.json(restored);
});

export default router;