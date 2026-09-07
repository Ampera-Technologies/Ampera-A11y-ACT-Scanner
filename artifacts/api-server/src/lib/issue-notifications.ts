import { and, eq, inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getEffectivePermissions } from "./permissions";
import { createNotification } from "./notifications";
import { sendIssueNotificationEmail } from "./email";
import { logger } from "./logger";

export type IssueNotificationEvent = "assigned" | "status_changed" | "commented" | "mentioned";

export interface IssueNotificationTarget {
  id: number;
  issueKey: string;
  title: string;
  status: string;
  reporterId: number;
  assigneeId: number | null;
}

export interface IssueRecipient {
  id: number;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
}

export function uniqueRecipientIds(actorId: number, candidateIds: Array<number | null | undefined>): number[] {
  return [...new Set(candidateIds.filter((id): id is number => Number.isInteger(id) && Number(id) > 0))]
    .filter((id) => id !== actorId);
}

export function splitCommentRecipientIds(
  issue: Pick<IssueNotificationTarget, "reporterId" | "assigneeId">,
  actorId: number,
  mentionIds: number[],
): { mentioned: number[]; commented: number[] } {
  const mentioned = uniqueRecipientIds(actorId, mentionIds);
  const mentionedSet = new Set(mentioned);
  const commented = uniqueRecipientIds(actorId, [issue.reporterId, issue.assigneeId])
    .filter((id) => !mentionedSet.has(id));
  return { mentioned, commented };
}

export async function filterEligibleIssueRecipients(
  candidateIds: number[],
  actorId: number,
  users: IssueRecipient[],
  canViewIssues: (user: IssueRecipient) => Promise<boolean>,
): Promise<IssueRecipient[]> {
  const candidates = new Set(uniqueRecipientIds(actorId, candidateIds));
  const results = await Promise.all(users.map(async (user) => (
    user.isActive && candidates.has(user.id) && await canViewIssues(user) ? user : null
  )));
  return results.filter((user): user is IssueRecipient => user !== null);
}

function statusLabel(status: string): string {
  return status.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function getPublicAppUrl(): string | null {
  const basePath = (process.env.BASE_PATH || "").replace(/\/+$/, "");
  const configuredUrl = process.env.APP_PUBLIC_URL?.trim();
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      if (parsed.protocol === "https:" || (process.env.NODE_ENV !== "production" && parsed.protocol === "http:")) {
        return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
      }
    } catch {
      logger.error("APP_PUBLIC_URL is not a valid HTTP(S) URL");
    }
  }
  const platformHost = process.env.WEBSITE_HOSTNAME
    || process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!platformHost || !/^[a-z0-9.-]+(?::\d+)?$/i.test(platformHost)) return null;
  return `https://${platformHost}${basePath}`;
}

function eventContent(input: {
  event: IssueNotificationEvent;
  issue: IssueNotificationTarget;
  actorName: string;
  previousStatus?: string;
  commentExcerpt?: string;
}) {
  const { event, issue, actorName } = input;
  if (event === "assigned") {
    return {
      title: `${issue.issueKey} assigned to you`,
      eventTitle: "Issue assigned to you",
      summary: `${actorName} assigned ${issue.issueKey} to you.`,
      body: issue.title,
    };
  }
  if (event === "status_changed") {
    const previous = input.previousStatus ? statusLabel(input.previousStatus) : "its previous status";
    const next = statusLabel(issue.status);
    return {
      title: `${issue.issueKey} moved to ${next}`,
      eventTitle: `Status changed to ${next}`,
      summary: `${actorName} moved ${issue.issueKey} from ${previous} to ${next}.`,
      body: issue.title,
    };
  }
  const excerpt = input.commentExcerpt?.trim() || "A new comment was added.";
  if (event === "mentioned") {
    return {
      title: `${actorName} mentioned you in ${issue.issueKey}`,
      eventTitle: "You were mentioned in a comment",
      summary: `${actorName} mentioned you in a comment on ${issue.issueKey}.`,
      body: excerpt,
    };
  }
  return {
    title: `New comment on ${issue.issueKey}`,
    eventTitle: "New issue comment",
    summary: `${actorName} commented on ${issue.issueKey}.`,
    body: excerpt,
  };
}

async function eligibleRecipients(candidateIds: number[], actorId: number): Promise<IssueRecipient[]> {
  const ids = uniqueRecipientIds(actorId, candidateIds);
  if (ids.length === 0) return [];
  const users = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    fullName: usersTable.fullName,
    role: usersTable.role,
    isActive: usersTable.isActive,
  }).from(usersTable).where(and(inArray(usersTable.id, ids), eq(usersTable.isActive, true)));
  return filterEligibleIssueRecipients(ids, actorId, users, async (user) => {
    const permissions = await getEffectivePermissions(user.id, user.role);
    return permissions.canViewIssues;
  });
}

export async function notifyIssueEvent(input: {
  event: IssueNotificationEvent;
  issue: IssueNotificationTarget;
  actorId: number;
  candidateRecipientIds: number[];
  previousStatus?: string;
  commentExcerpt?: string;
  commentBody?: string;
}): Promise<void> {
  try {
    const [actor] = await db.select({
      id: usersTable.id,
      fullName: usersTable.fullName,
    }).from(usersTable).where(eq(usersTable.id, input.actorId)).limit(1);
    const recipients = await eligibleRecipients(input.candidateRecipientIds, input.actorId);
    if (recipients.length === 0) return;

    const actorName = actor?.fullName || "A team member";
    const content = eventContent({ ...input, actorName });
    const link = `/issues?issueId=${input.issue.id}`;
    await createNotification({
      type: "issue",
      title: content.title,
      body: content.body,
      link,
      actorId: input.actorId,
      actorName,
      recipientIds: recipients.map((recipient) => recipient.id),
    });

    const publicAppUrl = getPublicAppUrl();
    if (!publicAppUrl) {
      logger.warn({ issueKey: input.issue.issueKey }, "Public app URL is unavailable — issue notification email not sent");
      return;
    }
    const issueUrl = `${publicAppUrl}${link}`;
    void Promise.allSettled(recipients.map((recipient) => sendIssueNotificationEmail({
      to: recipient.email,
      fullName: recipient.fullName,
      issueKey: input.issue.issueKey,
      issueTitle: input.issue.title,
      issueStatus: statusLabel(input.issue.status),
      eventTitle: content.eventTitle,
      eventSummary: content.summary,
      commentBody: input.commentBody,
      issueUrl,
    }))).catch((error) => {
      logger.error({ err: error, issueKey: input.issue.issueKey }, "Issue notification email dispatch failed");
    });
  } catch (error) {
    logger.error({ err: error, issueKey: input.issue.issueKey, event: input.event }, "Failed to dispatch issue notification");
  }
}