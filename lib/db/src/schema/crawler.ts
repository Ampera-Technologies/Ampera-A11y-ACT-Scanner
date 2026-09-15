import { pgTable, text, serial, integer, timestamp, jsonb, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sitesTable = pgTable("sites", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  description: text("description"),
  defaultScope: text("default_scope").notNull().default("subdomain"),
  sitemapUrl: text("sitemap_url"),
  crawlType: text("crawl_type").notNull().default("javascript"),
  maxPages: integer("max_pages").notNull().default(2000),
  maxDepth: integer("max_depth").notNull().default(5),
  respectRobotsTxt: boolean("respect_robots_txt").notNull().default(true),
  assetMode: text("asset_mode").notNull().default("all"),
  scheduleEnabled: boolean("schedule_enabled").notNull().default(false),
  scheduleIntervalDays: integer("schedule_interval_days").notNull().default(7),
  timezone: text("timezone").notNull().default("UTC"),
  nextCrawlAt: timestamp("next_crawl_at"),
  lastCompletedAt: timestamp("last_completed_at"),
  lifecycleStatus: text("lifecycle_status").notNull().default("idle"),
  targetScore: integer("target_score"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const siteContentRulesTable = pgTable("site_content_rules", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").notNull().references(() => sitesTable.id, { onDelete: "cascade" }),
  ruleType: text("rule_type").notNull(),
  pattern: text("pattern").notNull(),
  patternType: text("pattern_type").notNull().default("contains"),
  note: text("note"),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("site_content_rules_site_idx").on(t.siteId),
]);

export const crawlerSessionsTable = pgTable("crawler_sessions", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  siteId: integer("site_id").references(() => sitesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  seedUrl: text("seed_url").notNull(),
  status: text("status").notNull().default("pending"),
  lifecycleStatus: text("lifecycle_status").notNull().default("queued"),
  config: jsonb("config").notNull(),
  scanSessionId: integer("scan_session_id"),
  scheduledStartAt: timestamp("scheduled_start_at"),
  totalDiscovered: integer("total_discovered").notNull().default(0),
  totalScanned: integer("total_scanned").notNull().default(0),
  totalFailed: integer("total_failed").notNull().default(0),
  totalSkipped: integer("total_skipped").notNull().default(0),
  totalIssues: integer("total_issues").notNull().default(0),
  totalRules: integer("total_rules").notNull().default(0),
  brokenLinksCount: integer("broken_links_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  discoveredAt: timestamp("discovered_at"),
  scanStartedAt: timestamp("scan_started_at"),
  completedAt: timestamp("completed_at"),
  pausedAt: timestamp("paused_at"),
  errorMessage: text("error_message"),
});

export const crawlerPagesTable = pgTable("crawler_pages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => crawlerSessionsTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  urlHash: text("url_hash").notNull(),
  status: text("status").notNull().default("pending"),
  depth: integer("depth").notNull().default(0),
  discoveredFrom: text("discovered_from"),
  contentHash: text("content_hash"),
  httpStatus: integer("http_status"),
  finalUrl: text("final_url"),
  contentType: text("content_type"),
  responseCapturedAt: timestamp("response_captured_at"),
  issueCount: integer("issue_count").notNull().default(0),
  ruleCount: integer("rule_count").notNull().default(0),
  pageType: text("page_type"),
  errorMessage: text("error_message"),
  scannedAt: timestamp("scanned_at"),
  capturedHtml: text("captured_html"),
  discoveryAttempts: integer("discovery_attempts").notNull().default(0),
  discoveryLastAttemptAt: timestamp("discovery_last_attempt_at"),
  discoveryNextAttemptAt: timestamp("discovery_next_attempt_at"),
  discoveryLastError: text("discovery_last_error"),
}, (t) => [
  index("crawler_pages_session_status_idx").on(t.sessionId, t.status),
  index("crawler_pages_session_hash_idx").on(t.sessionId, t.urlHash),
]);

export const crawlerUrlEventsTable = pgTable("crawler_url_events", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => crawlerSessionsTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  disposition: text("disposition").notNull(),
  reason: text("reason").notNull(),
  sourceUrl: text("source_url"),
  ruleId: integer("rule_id").references(() => siteContentRulesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crawler_url_events_session_idx").on(t.sessionId),
  index("crawler_url_events_disposition_idx").on(t.sessionId, t.disposition),
]);

export const brokenLinksTable = pgTable("broken_links", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => crawlerSessionsTable.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  brokenUrl: text("broken_url").notNull(),
  httpStatus: integer("http_status"),
  errorType: text("error_type"),
  anchorText: text("anchor_text"),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
}, (t) => [
  index("broken_links_session_idx").on(t.sessionId),
]);

export const crawlerDiscoveryCacheTable = pgTable("crawler_discovery_cache", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  seedUrl: text("seed_url").notNull(),
  sourceSessionId: integer("source_session_id").references(() => crawlerSessionsTable.id, { onDelete: "set null" }),
  urlCount: integer("url_count").notNull().default(0),
  cachedAt: timestamp("cached_at").defaultNow().notNull(),
});

export const insertSiteSchema = createInsertSchema(sitesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSite = z.infer<typeof insertSiteSchema>;
export type Site = typeof sitesTable.$inferSelect;
export type SiteContentRule = typeof siteContentRulesTable.$inferSelect;
export type CrawlerUrlEvent = typeof crawlerUrlEventsTable.$inferSelect;

export const insertCrawlerSessionSchema = createInsertSchema(crawlerSessionsTable).omit({ id: true, createdAt: true });
export type InsertCrawlerSession = z.infer<typeof insertCrawlerSessionSchema>;
export type CrawlerSession = typeof crawlerSessionsTable.$inferSelect;

export const insertCrawlerPageSchema = createInsertSchema(crawlerPagesTable).omit({ id: true });
export type InsertCrawlerPage = z.infer<typeof insertCrawlerPageSchema>;
export type CrawlerPage = typeof crawlerPagesTable.$inferSelect;

export const insertBrokenLinkSchema = createInsertSchema(brokenLinksTable).omit({ id: true, checkedAt: true });
export type InsertBrokenLink = z.infer<typeof insertBrokenLinkSchema>;
export type BrokenLink = typeof brokenLinksTable.$inferSelect;
