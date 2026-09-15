import { pgTable, text, serial, integer, timestamp, jsonb, real, index, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { sitesTable } from "./crawler";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectSitesTable = pgTable("project_sites", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  siteId: integer("site_id").notNull().references(() => sitesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("project_sites_project_site_unique").on(t.projectId, t.siteId),
  index("project_sites_project_idx").on(t.projectId),
  index("project_sites_site_idx").on(t.siteId),
]);

export const scanSessionsTable = pgTable("scan_sessions", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  siteId: integer("site_id"), // references sites(id) — managed via startup migration
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  groupId: integer("group_id"), // references user_groups(id) — managed via startup migration
  name: text("name"),
  initiatorName: text("initiator_name"),
  initiatorRole: text("initiator_role"),
  status: text("status").notNull().default("pending"),
  totalUrls: integer("total_urls").notNull().default(0),
  scannedUrls: integer("scanned_urls").notNull().default(0),
  failedUrls: integer("failed_urls").notNull().default(0),
  totalIssues: integer("total_issues").notNull().default(0),
  criticalIssues: integer("critical_issues").notNull().default(0),
  options: jsonb("options"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const pageResultsTable = pgTable("page_results", {
  id: serial("id").primaryKey(),
  scanId: integer("scan_id").notNull().references(() => scanSessionsTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  status: text("status").notNull().default("pending"),
  issueCount: integer("issue_count").notNull().default(0),
  criticalCount: integer("critical_count").notNull().default(0),
  errorMessage: text("error_message"),
  scannedAt: timestamp("scanned_at"),
  loadDurationMs: integer("load_duration_ms"),
  scanDurationMs: integer("scan_duration_ms"),
  screenshot: text("screenshot"),
  pageHtml: text("page_html"),
  contentHash: text("content_hash"),
  carriedForward: boolean("carried_forward").default(false).notNull(),
  /** Sanitized HTTP provenance. url remains the requested URL for compatibility. */
  finalUrl: text("final_url"),
  httpStatus: integer("http_status"),
  contentType: text("content_type"),
  responseCapturedAt: timestamp("response_captured_at"),
  acquisitionMethod: text("acquisition_method"),
  proxyStrategy: text("proxy_strategy"),
  rawHtmlHash: text("raw_html_hash"),
  renderedDomHash: text("rendered_dom_hash"),
}, (t) => [
  index("page_results_scan_id_idx").on(t.scanId),
  index("page_results_url_hash_idx").on(t.url, t.contentHash),
]);

/** Registry evidence persisted independently of accessibility issue rows. */
export const ruleExecutionStatusesTable = pgTable("rule_execution_statuses", {
  id: serial("id").primaryKey(),
  pageResultId: integer("page_result_id").notNull().references(() => pageResultsTable.id, { onDelete: "cascade" }),
  ruleId: text("rule_id").notNull(),
  status: text("status").notNull(),
  executionTier: text("execution_tier").notNull().default("automatic"),
  carriedForward: boolean("carried_forward").notNull().default(false),
}, (t) => [
  uniqueIndex("rule_execution_statuses_page_rule_unique").on(t.pageResultId, t.ruleId),
  index("rule_execution_statuses_page_idx").on(t.pageResultId),
  index("rule_execution_statuses_rule_idx").on(t.ruleId, t.status),
]);

export const pageInteractionStatesTable = pgTable("page_interaction_states", {
  id: serial("id").primaryKey(),
  pageId: integer("page_id").notNull().references(() => pageResultsTable.id, { onDelete: "cascade" }),
  stateKey: text("state_key").notNull(),
  triggerSelector: text("trigger_selector"),
  triggerLabel: text("trigger_label"),
  screenshot: text("screenshot"),
  pageHtml: text("page_html"),
}, (t) => [
  index("page_interaction_states_page_id_idx").on(t.pageId),
]);

export const accessibilityIssuesTable = pgTable("accessibility_issues", {
  id: serial("id").primaryKey(),
  pageId: integer("page_id").notNull().references(() => pageResultsTable.id, { onDelete: "cascade" }),
  ruleId: text("rule_id").notNull(),
  ruleType: text("rule_type").default("Issue").notNull(),
  impact: text("impact").notNull(),
  description: text("description").notNull(),
  element: text("element"),
  elementContext: text("element_context"),
  wcagCriteria: text("wcag_criteria"),
  wcagLevel: text("wcag_level"),
  legalText: text("legal_text"),
  selector: text("selector"),
  remediation: text("remediation"),
  bboxX: real("bbox_x"),
  bboxY: real("bbox_y"),
  bboxWidth: real("bbox_width"),
  bboxHeight: real("bbox_height"),
  interactionStateId: integer("interaction_state_id").references(() => pageInteractionStatesTable.id, { onDelete: "set null" }),
  falsePositive: boolean("false_positive").default(false).notNull(),
  falsePositiveNote: text("false_positive_note"),
}, (t) => [
  index("accessibility_issues_page_id_idx").on(t.pageId),
]);

export const aiIssueAssessmentsTable = pgTable("ai_issue_assessments", {
  id: serial("id").primaryKey(),
  issueId: integer("issue_id").notNull().references(() => accessibilityIssuesTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"),
  decision: text("decision"),
  confidence: text("confidence"),
  rationale: text("rationale"),
  evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
  engine: text("engine").notNull().default("Alfa/custom browser"),
  provider: text("provider"),
  model: text("model"),
  attempts: integer("attempts").notNull().default(0),
  requestContext: jsonb("request_context").$type<Record<string, unknown>>().notNull(),
  errorMessage: text("error_message"),
  queuedAt: timestamp("queued_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("ai_issue_assessments_issue_unique").on(t.issueId),
  index("ai_issue_assessments_status_idx").on(t.status),
]);

export const qaPagesTable = pgTable("qa_pages", {
  id: serial("id").primaryKey(),
  scanId: integer("scan_id").notNull().references(() => scanSessionsTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  title: text("title"),
  metaDescription: text("meta_description"),
  h1: text("h1"),
  httpStatus: integer("http_status"),
  wordCount: integer("word_count"),
  contentHash: text("content_hash"),
  crawlDepth: integer("crawl_depth"),
  inlinkCount: integer("inlink_count").notNull().default(0),
  isPdf: boolean("is_pdf").notNull().default(false),
  lastModified: text("last_modified"),
  bodyText: text("body_text"),
  inSitemap: boolean("in_sitemap").notNull().default(false),
  scannedAt: timestamp("scanned_at").defaultNow(),
}, (t) => [
  index("qa_pages_scan_id_idx").on(t.scanId),
]);

export const qaLinksTable = pgTable("qa_links", {
  id: serial("id").primaryKey(),
  scanId: integer("scan_id").notNull().references(() => scanSessionsTable.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  destUrl: text("dest_url").notNull(),
  anchorText: text("anchor_text"),
  linkType: text("link_type").notNull().default("internal"),
  isUnsafe: boolean("is_unsafe").notNull().default(false),
  httpStatus: integer("http_status"),
  isRedirect: boolean("is_redirect").notNull().default(false),
  redirectTo: text("redirect_to"),
  checkedAt: timestamp("checked_at"),
}, (t) => [
  index("qa_links_scan_id_idx").on(t.scanId),
  index("qa_links_dest_url_idx").on(t.scanId, t.destUrl),
]);

export const qaImagesTable = pgTable("qa_images", {
  id: serial("id").primaryKey(),
  scanId: integer("scan_id").notNull().references(() => scanSessionsTable.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  src: text("src").notNull(),
  alt: text("alt"),
  width: integer("width"),
  height: integer("height"),
  isExternal: boolean("is_external").notNull().default(false),
  httpStatus: integer("http_status"),
  isBroken: boolean("is_broken").notNull().default(false),
  checkedAt: timestamp("checked_at"),
}, (t) => [
  index("qa_images_scan_id_idx").on(t.scanId),
]);

export const qaWordInventoryTable = pgTable("qa_word_inventory", {
  id: serial("id").primaryKey(),
  scanId: integer("scan_id").notNull().references(() => scanSessionsTable.id, { onDelete: "cascade" }),
  word: text("word").notNull(),
  pageCount: integer("page_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(0),
}, (t) => [
  index("qa_word_inventory_scan_id_idx").on(t.scanId),
]);

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;

export const insertScanSessionSchema = createInsertSchema(scanSessionsTable).omit({ id: true, createdAt: true, completedAt: true });
export type InsertScanSession = z.infer<typeof insertScanSessionSchema>;
export type ScanSession = typeof scanSessionsTable.$inferSelect;

export const insertPageResultSchema = createInsertSchema(pageResultsTable).omit({ id: true, scannedAt: true });
export type InsertPageResult = z.infer<typeof insertPageResultSchema>;
export type PageResult = typeof pageResultsTable.$inferSelect;

export const insertAccessibilityIssueSchema = createInsertSchema(accessibilityIssuesTable).omit({ id: true });
export type InsertAccessibilityIssue = z.infer<typeof insertAccessibilityIssueSchema>;
export type AccessibilityIssue = typeof accessibilityIssuesTable.$inferSelect;

export const issueDecisionsTable = pgTable("issue_decisions", {
  id: serial("id").primaryKey(),
  scanSessionId: integer("scan_session_id").notNull().references(() => scanSessionsTable.id, { onDelete: "cascade" }),
  pageId: integer("page_id"),
  issueId: integer("issue_id"),
  ruleId: text("rule_id").notNull(),
  selector: text("selector"),
  elementSnippet: text("element_snippet"),
  pageUrl: text("page_url"),
  issueDescription: text("issue_description"),
  decisionType: text("decision_type").notNull(),
  scope: text("scope").notNull().default("single"),
  classPattern: text("class_pattern"),
  pagesAffected: integer("pages_affected"),
  reason: text("reason"),
  submittedBy: integer("submitted_by").notNull(),
  submitterName: text("submitter_name"),
  reviewStatus: text("review_status").notNull().default("pending"),
  reviewedBy: integer("reviewed_by"),
  reviewerName: text("reviewer_name"),
  reviewComment: text("review_comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type IssueDecision = typeof issueDecisionsTable.$inferSelect;
export type InsertIssueDecision = typeof issueDecisionsTable.$inferInsert;
