import nodemailer from "nodemailer";
import { logger } from "./logger";
import { db, appSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

const SMTP_KEYS = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from"] as const;

async function getSmtpConfig() {
  try {
    const rows = await db
      .select({
        key: appSettingsTable.key,
        value: appSettingsTable.value,
      })
      .from(appSettingsTable)
      .where(inArray(appSettingsTable.key, [...SMTP_KEYS]));

    const map: Record<string, string> = {};
    for (const row of rows) {
      if (row.value) map[row.key] = row.value;
    }

    const host = map["smtp_host"] || process.env.SMTP_HOST;
    const port = parseInt(map["smtp_port"] || process.env.SMTP_PORT || "587", 10);
    const user = map["smtp_user"] || process.env.SMTP_USER;
    const pass = map["smtp_pass"] || process.env.SMTP_PASS;
    const from = map["smtp_from"] || process.env.SMTP_FROM || "noreply@amperatech.ai";

    return { host, port, user, pass, from };
  } catch {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || "noreply@amperatech.ai";
    return { host, port, user, pass, from };
  }
}

async function createTransport() {
  const { host, port, user, pass } = await getSmtpConfig();
  if (!host || !user || !pass) return null;
  const secure = port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    tls: { rejectUnauthorized: true },
    auth: { user, pass },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export interface IssueNotificationEmailOptions {
  to: string;
  fullName: string;
  issueKey: string;
  issueTitle: string;
  issueStatus: string;
  eventTitle: string;
  eventSummary: string;
  commentBody?: string;
  issueUrl: string;
}

export function buildIssueNotificationEmail(opts: IssueNotificationEmailOptions) {
  const subject = `[${opts.issueKey}] ${opts.eventTitle}`;
  const text = [
    `Hi ${opts.fullName},`,
    "",
    opts.eventSummary,
    "",
    "Comment:",
    opts.commentBody?.trim() || "A new comment was added.",
    "",
    "Issue details:",
    `Issue no: ${opts.issueKey}`,
    `Title: ${opts.issueTitle}`,
    `Status: ${opts.issueStatus}`,
    `Open issue: ${opts.issueUrl}`,
  ].join("\n");
  const html = `
    <p>Hi ${escapeHtml(opts.fullName)},</p>
    <p>${escapeHtml(opts.eventSummary)}</p>
    <p><strong>Comment</strong></p>
    <blockquote>${escapeHtml(opts.commentBody?.trim() || "A new comment was added.")}</blockquote>
    <p><strong>Issue details</strong></p>
    <ul>
      <li><strong>Issue no:</strong> ${escapeHtml(opts.issueKey)}</li>
      <li><strong>Title:</strong> ${escapeHtml(opts.issueTitle)}</li>
      <li><strong>Status:</strong> ${escapeHtml(opts.issueStatus)}</li>
    </ul>
    <p><a href="${escapeHtml(opts.issueUrl)}">Open issue</a></p>
  `;
  return { subject, text, html };
}

export async function sendIssueNotificationEmail(opts: IssueNotificationEmailOptions): Promise<boolean> {
  const { from } = await getSmtpConfig();
  const transport = await createTransport();
  if (!transport) {
    logger.warn({ issueKey: opts.issueKey }, "SMTP not configured — issue notification email not sent");
    return false;
  }
  const { subject, text, html } = buildIssueNotificationEmail(opts);

  try {
    await transport.sendMail({ from, to: opts.to, subject, text, html });
    return true;
  } catch (err) {
    logger.error({ err, issueKey: opts.issueKey }, "Failed to send issue notification email");
    return false;
  }
}

export async function sendInviteEmail(opts: {
  to: string;
  fullName: string;
  username: string;
  tempPassword: string;
  inviteToken: string;
  appUrl: string;
}): Promise<boolean> {
  const { from } = await getSmtpConfig();
  const transport = await createTransport();
  const resetLink = `${opts.appUrl}/reset-password?token=${opts.inviteToken}`;

  const text = `Hi ${opts.fullName},\n\nYou have been invited to the A11y ACT Tool.\n\nUsername: ${opts.username}\nTemporary password: ${opts.tempPassword}\n\nPlease click the link below to set your own password:\n${resetLink}\n\nThis link expires in 72 hours.`;

  if (!transport) {
    logger.warn({ to: opts.to }, "SMTP not configured — invite email not sent. Temp password logged below (dev only).");
    logger.info({ username: opts.username, tempPassword: opts.tempPassword, resetLink }, "DEV: invite details");
    return false;
  }

  try {
    await transport.sendMail({ from, to: opts.to, subject: "You're invited to A11y ACT Tool", text });
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send invite email");
    return false;
  }
}

export async function sendTestEmail(opts: { to: string }): Promise<{ ok: boolean; error?: string }> {
  const { from } = await getSmtpConfig();
  const transport = await createTransport();
  if (!transport) return { ok: false, error: "SMTP not configured — host, user, or password is missing." };
  try {
    await transport.sendMail({
      from,
      to: opts.to,
      subject: "A11y ACT Tool — SMTP Test",
      text: "This is a test email from the A11y ACT Tool. Your SMTP configuration is working correctly.",
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Failed to send test email");
    return { ok: false, error: message };
  }
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  fullName: string;
  resetToken: string;
  appUrl: string;
}): Promise<boolean> {
  const { from } = await getSmtpConfig();
  const transport = await createTransport();
  const resetLink = `${opts.appUrl}/reset-password?token=${opts.resetToken}`;

  if (!transport) {
    logger.warn({ to: opts.to }, "SMTP not configured — password reset email not sent");
    return false;
  }

  try {
    await transport.sendMail({
      from,
      to: opts.to,
      subject: "Reset your A11y ACT Tool password",
      text: `Hi ${opts.fullName},\n\nClick below to reset your password:\n${resetLink}\n\nThis link expires in 1 hour.`,
    });
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send password reset email");
    return false;
  }
}
