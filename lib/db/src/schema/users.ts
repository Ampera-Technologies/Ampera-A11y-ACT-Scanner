import { pgTable, text, serial, integer, timestamp, boolean, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  profileImageUrl: text("profile_image_url"),
  profileImageContentType: text("profile_image_content_type"),
  role: text("role").notNull().default("user"), // "super_admin" | "admin" | "user"
  isActive: boolean("is_active").notNull().default(true),
  mustResetPassword: boolean("must_reset_password").notNull().default(true),
  inviteToken: text("invite_token"),
  inviteTokenExpiresAt: timestamp("invite_token_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userGroupsTable = pgTable("user_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  roleLabel: text("role_label"), // auto-fills "Role" on scan form when this group is selected
  canScan: boolean("can_scan").notNull().default(false),
  canExport: boolean("can_export").notNull().default(false),
  canViewAllScans: boolean("can_view_all_scans").notNull().default(false),
  canEditScan: boolean("can_edit_scan").notNull().default(false),
  canDeleteScan: boolean("can_delete_scan").notNull().default(false),
  canManageScan: boolean("can_manage_scan").notNull().default(false),
  canCreateProject: boolean("can_create_project").notNull().default(false),
  canDeleteProject: boolean("can_delete_project").notNull().default(false),
  canDisableJs: boolean("can_disable_js").notNull().default(false),
  canSmartAnalysis: boolean("can_smart_analysis").notNull().default(false),
  canSwitchSite: boolean("can_switch_site").notNull().default(false),
  canCreateCrawl: boolean("can_create_crawl").notNull().default(false),
  canDeleteCrawl: boolean("can_delete_crawl").notNull().default(false),
  canViewCrawlHistory: boolean("can_view_crawl_history").notNull().default(false),
  canViewQualityAssurance: boolean("can_view_quality_assurance").notNull().default(false),
  canViewSiteAccessibilityDashboard: boolean("can_view_site_accessibility_dashboard").notNull().default(false),
  canViewHtmlReplay: boolean("can_view_html_replay").notNull().default(false),
  canManageSites: boolean("can_manage_sites").notNull().default(false),
  canManageSiteTargetScore: boolean("can_manage_site_target_score").notNull().default(false),
  canViewIssues: boolean("can_view_issues").notNull().default(false),
  canCreateIssue: boolean("can_create_issue").notNull().default(false),
  canEditIssue: boolean("can_edit_issue").notNull().default(false),
  canCommentIssue: boolean("can_comment_issue").notNull().default(false),
  canManageIssues: boolean("can_manage_issues").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userGroupMembersTable = pgTable("user_group_members", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  groupId: integer("group_id").notNull().references(() => userGroupsTable.id, { onDelete: "cascade" }),
}, (t) => [
  index("ugm_user_idx").on(t.userId),
  index("ugm_group_idx").on(t.groupId),
]);

export const userPermissionsTable = pgTable("user_permissions", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  canScan: boolean("can_scan").notNull().default(true),
  canExport: boolean("can_export").notNull().default(true),
  canViewAllScans: boolean("can_view_all_scans").notNull().default(false),
  canEditScan: boolean("can_edit_scan").notNull().default(true),
  canDeleteScan: boolean("can_delete_scan").notNull().default(true),
  canManageScan: boolean("can_manage_scan").notNull().default(true), // pause/resume/cancel/retry
  canCreateProject: boolean("can_create_project").notNull().default(true),
  canDeleteProject: boolean("can_delete_project").notNull().default(true),
  canDisableJs: boolean("can_disable_js").notNull().default(false),
  canSmartAnalysis: boolean("can_smart_analysis").notNull().default(false),
  canSwitchSite: boolean("can_switch_site").notNull().default(false),
  canCreateCrawl: boolean("can_create_crawl").notNull().default(true),
  canDeleteCrawl: boolean("can_delete_crawl").notNull().default(true),
  canViewCrawlHistory: boolean("can_view_crawl_history").notNull().default(true),
  canViewQualityAssurance: boolean("can_view_quality_assurance").notNull().default(true),
  canViewSiteAccessibilityDashboard: boolean("can_view_site_accessibility_dashboard").notNull().default(true),
  canViewHtmlReplay: boolean("can_view_html_replay").notNull().default(false),
  canManageSites: boolean("can_manage_sites").notNull().default(false),
  canManageSiteTargetScore: boolean("can_manage_site_target_score").notNull().default(false),
  canViewIssues: boolean("can_view_issues").notNull().default(true),
  canCreateIssue: boolean("can_create_issue").notNull().default(true),
  canEditIssue: boolean("can_edit_issue").notNull().default(true),
  canCommentIssue: boolean("can_comment_issue").notNull().default(true),
  canManageIssues: boolean("can_manage_issues").notNull().default(true),
  allowedRules: jsonb("allowed_rules"), // null = all rules; string[] = restricted list
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by"),
});

export const supportTicketsTable = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"), // "open" | "in_progress" | "resolved" | "closed"
  priority: text("priority").notNull().default("medium"), // "low" | "medium" | "high" | "critical"
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("tickets_user_idx").on(t.userId),
]);

export const ticketRepliesTable = pgTable("ticket_replies", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTicketsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("replies_ticket_idx").on(t.ticketId),
]);

export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by"),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true, passwordHash: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const insertUserGroupSchema = createInsertSchema(userGroupsTable).omit({ id: true, createdAt: true });
export type InsertUserGroup = z.infer<typeof insertUserGroupSchema>;
export type UserGroup = typeof userGroupsTable.$inferSelect;

export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({ id: true, createdAt: true, updatedAt: true, userId: true });
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTicketsTable.$inferSelect;
