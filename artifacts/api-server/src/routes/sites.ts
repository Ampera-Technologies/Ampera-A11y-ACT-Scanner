import { Router, type IRouter, type Request, type Response } from "express";
import type { PoolClient } from "pg";
import { db, pool } from "@workspace/db";
import {
  sitesTable,
  siteContentRulesTable,
  crawlerSessionsTable,
  crawlerPagesTable,
  crawlerUrlEventsTable,
  qaLinksTable,
  qaImagesTable,
  siteUserAccessTable,
  siteGroupAccessTable,
  userGroupsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/authMiddleware";
import { getEffectiveSites, canAccessSite, getEffectivePermissions } from "../lib/permissions";
import { startCrawlerJob, type CrawlerConfig } from "../lib/crawler";
import { aggregateRuleCoverage, classifyScanConfidence } from "../lib/ruleCoverage";

const router: IRouter = Router();
const siteColumns = {
  id: sitesTable.id, userId: sitesTable.userId, name: sitesTable.name, baseUrl: sitesTable.baseUrl, description: sitesTable.description,
  defaultScope: sitesTable.defaultScope, sitemapUrl: sitesTable.sitemapUrl, crawlType: sitesTable.crawlType, maxPages: sitesTable.maxPages,
  maxDepth: sitesTable.maxDepth, respectRobotsTxt: sitesTable.respectRobotsTxt, assetMode: sitesTable.assetMode,
  scheduleEnabled: sitesTable.scheduleEnabled, scheduleIntervalDays: sitesTable.scheduleIntervalDays, timezone: sitesTable.timezone,
  nextCrawlAt: sitesTable.nextCrawlAt, lastCompletedAt: sitesTable.lastCompletedAt, lifecycleStatus: sitesTable.lifecycleStatus,
  targetScore: sitesTable.targetScore, createdAt: sitesTable.createdAt, updatedAt: sitesTable.updatedAt,
};
const siteContentRuleColumns = {
  id: siteContentRulesTable.id, siteId: siteContentRulesTable.siteId, ruleType: siteContentRulesTable.ruleType,
  pattern: siteContentRulesTable.pattern, patternType: siteContentRulesTable.patternType, note: siteContentRulesTable.note,
  enabled: siteContentRulesTable.enabled, createdBy: siteContentRulesTable.createdBy, createdAt: siteContentRulesTable.createdAt, updatedAt: siteContentRulesTable.updatedAt,
};

// ── Scoring model v2 — per-rule weighted deductions ─────────────────────────
// Every rule gets its own static weight (Mr) derived from its WCAG level ×
// severity, instead of a flat "critical = 10 / serious = 5" bucket shared by
// every rule. That weight is then scaled down by how much of the site the
// rule actually touches (breadth) and how densely it occurs (density), so a
// rule only costs its full weight when it's both widespread AND persistent —
// e.g. a broken header component that fails on every page. A rare, isolated
// issue costs very little. This mirrors how Siteimprove assigns a unique
// point value to every individual check rather than to a severity bucket.
const LEVEL_BASE_WEIGHT: Record<string, number> = {
  "A":             3.0,   // Baseline blockers — content becomes unusable
  "AA":            2.0,   // Standard enterprise/legal compliance tier
  "AAA":           1.2,   // Enhanced criteria
  "WAI-ARIA":      1.0,   // Platform technique correctness
  "Best Practice": 1.0,   // General robustness
};

const SEVERITY_BASE_WEIGHT: Record<string, number> = {
  critical: 2.5,   // Error — complete barrier to accessibility
  serious:  1.5,   // Warning — severe friction / broken layout
  moderate: 0.5,   // Review — needs manual confirmation
  minor:    0.25,  // Review — minor/cosmetic
};

const WCAG_TARGET_LEVELS = ["A", "AA", "AAA", "All"] as const;
type WcagTargetLevel = typeof WCAG_TARGET_LEVELS[number];

function scopedWcagLevels(targetLevel: WcagTargetLevel): string[] {
  if (targetLevel === "A")   return ["A"];
  if (targetLevel === "AA")  return ["A", "AA"];
  if (targetLevel === "AAA") return ["A", "AA", "AAA"];
  // "All" — include every known level
  return ["A", "AA", "AAA", "WAI-ARIA", "Best Practice"];
}

async function resolvePageGroupScope(
  client: PoolClient,
  crawlerId: number,
  rawValue: unknown,
): Promise<{ value: string | null; error?: string }> {
  const requested = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!requested) return { value: null };
  const knownGroup = await client.query(
    `SELECT 1 FROM crawler_pages
     WHERE session_id = $1 AND COALESCE(page_type, 'General') = $2
     LIMIT 1`,
    [crawlerId, requested],
  );
  return knownGroup.rowCount ? { value: requested } : { value: null, error: "The selected page group was not found for this site" };
}

// Static ceiling weight (Mr) for a rule, from its fixed level + severity.
function ruleMultiplier(level: string, impact: string): number {
  return (LEVEL_BASE_WEIGHT[level] ?? 1.0) * (SEVERITY_BASE_WEIGHT[impact] ?? 0.25);
}

// Points actually deducted by one rule for the current scan.
//   breadth       = fraction of scanned pages that have ≥1 occurrence of this rule
//   failureRatio  = occurrences / total_checked elements when rule_page_stats are
//                   available (true CRr); falls back to occurrences/totalScanned
//                   for scans that predate the stats table.
function ruleDeduction(
  level: string,
  impact: string,
  occurrences: number,
  pagesAffected: number,
  totalScanned: number,
  totalChecked?: number,
): number {
  if (totalScanned === 0) return 0;
  const mr = ruleMultiplier(level, impact);
  const breadth = Math.min(1, pagesAffected / totalScanned);
  // CRr: compliance ratio.  When rule_page_stats are available use the true
  // element-level ratio (failures/totalChecked).  Fall back to the page-count
  // proxy for scans that predate the stats table.
  const failureRatio = (totalChecked && totalChecked > 0)
    ? Math.min(1, occurrences / totalChecked)   // true CRr  (1 - passed/total)
    : Math.min(1, occurrences / totalScanned);  // proxy (old scans / page-scoped rules)
  return mr * breadth * failureRatio;
}

// SQL fragments so the same weights are used consistently in every query below.
const SQL_LEVEL_WEIGHT_CASE = `CASE COALESCE(NULLIF(MAX(ai.wcag_level), ''), 'Best Practice')
    WHEN 'A' THEN 3.0 WHEN 'AA' THEN 2.0 WHEN 'AAA' THEN 1.2
    WHEN 'WAI-ARIA' THEN 1.0 ELSE 1.0 END`;
const SQL_SEVERITY_WEIGHT_CASE = `CASE ai.impact
    WHEN 'critical' THEN 2.5 WHEN 'serious' THEN 1.5
    WHEN 'moderate' THEN 0.5 ELSE 0.25 END`;

function getAuthUserId(req: any): string {
  return req.session?.user?.id?.toString() ?? "";
}
function isAdminUser(req: any): boolean {
  const role = req.session?.user?.role;
  return role === "super_admin" || role === "admin";
}

router.get("/sites", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getAuthUserId(req);
  const adminUser = isAdminUser(req);
  const session = (req as any).session?.user;
  const role: string = session?.role ?? "user";

  if (!adminUser) {
    const userIdNum: number = session?.id ?? 0;
    const effectiveSites = await getEffectiveSites(userIdNum, userId, role);
    res.json({ sites: effectiveSites });
    return;
  }

  const rows = await db.select(siteColumns).from(sitesTable).orderBy(desc(sitesTable.createdAt));

  if (rows.length === 0) {
    res.json({ sites: rows });
    return;
  }

  // For admin users, enrich with aggregate counts
  const siteIds = rows.map((s) => s.id);

  const [userCounts, scanCounts] = await Promise.all([
    // Count direct user access grants per site
    pool.query<{ site_id: number; user_count: string }>(
      `SELECT site_id, COUNT(DISTINCT user_id)::text AS user_count
       FROM site_user_access
       WHERE site_id = ANY($1::int[])
       GROUP BY site_id`,
      [siteIds],
    ),
    // Count scan sessions per site
    pool.query<{ site_id: number; scan_count: string }>(
      `SELECT site_id, COUNT(*)::text AS scan_count
       FROM scan_sessions
       WHERE site_id = ANY($1::int[])
       GROUP BY site_id`,
      [siteIds],
    ),
  ]);

  const userCountMap = new Map(userCounts.rows.map((r) => [r.site_id, parseInt(r.user_count, 10)]));
  const scanCountMap = new Map(scanCounts.rows.map((r) => [r.site_id, parseInt(r.scan_count, 10)]));

  const sites = rows.map((s) => ({
    ...s,
    userCount: userCountMap.get(s.id) ?? 0,
    scanCount: scanCountMap.get(s.id) ?? 0,
  }));

  res.json({ sites });
});

// GET /api/sites/my-sites — returns all sites accessible to the current user
// Used by the global site selector to populate the dropdown.
// super_admin → all sites (role: "admin")
// everyone else → union of direct site_user_access, legacy ownership,
// and sites granted through group membership
router.get("/sites/my-sites", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const session = (req as any).session?.user;
  const userId: number = session?.id ?? 0;
  const userIdStr: string = String(userId);
  const role: string = session?.role ?? "user";

  // The global selector is intentionally stricter than general admin
  // operations: only Superadmin can see every site. Admins must have an
  // explicit direct, ownership, or group-based site relationship.
  const selectorRole = role === "super_admin" ? "super_admin" : "user";
  const sites = await getEffectiveSites(userId, userIdStr, selectorRole);
  res.json({ sites });
});

// ── Admin: site access management ─────────────────────────────────────────────

// GET /api/admin/sites/:id/access — list users and groups with access to a site
router.get("/admin/sites/:id/access", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);

  const [[site], userRows, groupRows] = await Promise.all([
    db.select({ userId: sitesTable.userId }).from(sitesTable).where(eq(sitesTable.id, siteId)).limit(1),
    db
      .select({
        userId: siteUserAccessTable.userId,
        role: siteUserAccessTable.role,
        fullName: usersTable.fullName,
        email: usersTable.email,
        username: usersTable.username,
        createdAt: siteUserAccessTable.createdAt,
      })
      .from(siteUserAccessTable)
      .innerJoin(usersTable, eq(siteUserAccessTable.userId, usersTable.id))
      .where(eq(siteUserAccessTable.siteId, siteId))
      .orderBy(usersTable.fullName),
    db
      .select({
        groupId: siteGroupAccessTable.groupId,
        name: userGroupsTable.name,
        description: userGroupsTable.description,
        createdAt: siteGroupAccessTable.createdAt,
      })
      .from(siteGroupAccessTable)
      .innerJoin(userGroupsTable, eq(siteGroupAccessTable.groupId, userGroupsTable.id))
      .where(eq(siteGroupAccessTable.siteId, siteId))
      .orderBy(userGroupsTable.name),
  ]);

  // Include the legacy owner (sites.user_id) if not already in the access list
  const directUserIds = new Set(userRows.map((r) => r.userId));
  const legacyOwnerId = site?.userId ? parseInt(site.userId, 10) : NaN;
  if (!isNaN(legacyOwnerId) && !directUserIds.has(legacyOwnerId)) {
    const [legacyUser] = await db
      .select({ id: usersTable.id, fullName: usersTable.fullName, email: usersTable.email, username: usersTable.username, createdAt: usersTable.createdAt })
      .from(usersTable)
      .where(eq(usersTable.id, legacyOwnerId))
      .limit(1);
    if (legacyUser) {
      userRows.unshift({
        userId: legacyUser.id,
        role: "owner",
        fullName: legacyUser.fullName,
        email: legacyUser.email,
        username: legacyUser.username,
        createdAt: legacyUser.createdAt,
      });
    }
  }

  res.json({ users: userRows, groups: groupRows });
});

// POST /api/admin/sites/:id/users — grant a user access to a site
router.post("/admin/sites/:id/users", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  const { userId, role } = req.body ?? {};
  const requestingRole = (req as any).session?.user?.role;

  if (!userId || isNaN(parseInt(userId, 10))) {
    res.status(400).json({ error: "userId is required" }); return;
  }
  const finalRole = role === "owner" && requestingRole === "super_admin" ? "owner" : "member";

  await db
    .insert(siteUserAccessTable)
    .values({ siteId, userId: parseInt(userId, 10), role: finalRole })
    .onConflictDoUpdate({
      target: [siteUserAccessTable.siteId, siteUserAccessTable.userId],
      set: { role: finalRole },
    });

  res.status(201).json({ ok: true });
});

// DELETE /api/admin/sites/:id/users/:userId — revoke a user's access to a site
router.delete("/admin/sites/:id/users/:userId", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  const userId = parseInt(req.params["userId"] as string, 10);

  await db
    .delete(siteUserAccessTable)
    .where(and(eq(siteUserAccessTable.siteId, siteId), eq(siteUserAccessTable.userId, userId)));

  res.status(204).send();
});

// POST /api/admin/sites/:id/groups — grant a group access to a site
router.post("/admin/sites/:id/groups", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  const { groupId } = req.body ?? {};

  if (!groupId || isNaN(parseInt(groupId, 10))) {
    res.status(400).json({ error: "groupId is required" }); return;
  }

  await db
    .insert(siteGroupAccessTable)
    .values({ siteId, groupId: parseInt(groupId, 10) })
    .onConflictDoNothing();

  res.status(201).json({ ok: true });
});

// DELETE /api/admin/sites/:id/groups/:groupId — revoke a group's access to a site
router.delete("/admin/sites/:id/groups/:groupId", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  const groupId = parseInt(req.params["groupId"] as string, 10);

  await db
    .delete(siteGroupAccessTable)
    .where(and(eq(siteGroupAccessTable.siteId, siteId), eq(siteGroupAccessTable.groupId, groupId)));

  res.status(204).send();
});

router.post("/sites", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionUser = (req as any).session?.user;
  const createPerms = await getEffectivePermissions(sessionUser?.id ?? 0, sessionUser?.role ?? "user");
  if (!createPerms.canManageSites) {
    res.status(403).json({ error: "Site management is disabled" });
    return;
  }
  const userId = getAuthUserId(req);
  const { name, baseUrl, description } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "name is required" }); return;
  }
  if (!baseUrl || typeof baseUrl !== "string") {
    res.status(400).json({ error: "baseUrl is required" }); return;
  }
  try { new URL(baseUrl); } catch {
    res.status(400).json({ error: "baseUrl must be a valid URL" }); return;
  }

  const [site] = await db.insert(sitesTable).values({
    userId,
    name: name.trim(),
    baseUrl: baseUrl.trim(),
    description: typeof description === "string" ? description.trim() || null : null,
  }).returning();

  res.status(201).json(site);
});

router.get("/sites/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  const session = (req as any).session?.user;
  const userId: number = session?.id ?? 0;
  const userIdStr: string = String(userId);
  const role: string = session?.role ?? "user";

  const [site] = await db.select(siteColumns).from(sitesTable).where(eq(sitesTable.id, siteId)).limit(1);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  const access = await canAccessSite(userId, userIdStr, role, siteId);
  if (!access) { res.status(403).json({ error: "Forbidden" }); return; }

  res.json(site);
});

router.put("/sites/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionUser = (req as any).session?.user;
  const updatePerms = await getEffectivePermissions(sessionUser?.id ?? 0, sessionUser?.role ?? "user");
  if (!updatePerms.canManageSites) {
    res.status(403).json({ error: "Site management is disabled" });
    return;
  }
  const siteId = parseInt(req.params["id"] as string, 10);
  const session = (req as any).session?.user;
  const userId: number = session?.id ?? 0;
  const userIdStr: string = String(userId);
  const role: string = session?.role ?? "user";
  const adminUser = role === "super_admin" || role === "admin";

  const [site] = await db.select(siteColumns).from(sitesTable).where(eq(sitesTable.id, siteId)).limit(1);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  const access = await canAccessSite(userId, userIdStr, role, siteId);
  if (!access || access === "member") { res.status(403).json({ error: "Forbidden" }); return; }

  const { name, baseUrl, description, ownerUserId } = req.body;
  const updates: any = { updatedAt: new Date() };
  if (name && typeof name === "string") updates.name = name.trim();
  if (baseUrl && typeof baseUrl === "string") {
    try { new URL(baseUrl); updates.baseUrl = baseUrl.trim(); } catch {
      res.status(400).json({ error: "baseUrl must be a valid URL" }); return;
    }
  }
  if (description !== undefined) updates.description = typeof description === "string" ? description.trim() || null : null;
  // Only admins can reassign which user "owns" a site (drives that user's
  // Dashboard/Issues/Compliance sidebar nav).
  if (ownerUserId !== undefined) {
    if (!adminUser) { res.status(403).json({ error: "Only admins can reassign site ownership" }); return; }
    if (ownerUserId === null) { updates.userId = null; }
    else if (typeof ownerUserId === "string" || typeof ownerUserId === "number") {
      updates.userId = String(ownerUserId);
    } else {
      res.status(400).json({ error: "ownerUserId must be a string, number, or null" }); return;
    }
  }

  const [updated] = await db.update(sitesTable).set(updates).where(eq(sitesTable.id, siteId)).returning();
  res.json(updated);
});

router.delete("/sites/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionUser = (req as any).session?.user;
  const deletePerms = await getEffectivePermissions(sessionUser?.id ?? 0, sessionUser?.role ?? "user");
  if (!deletePerms.canManageSites) {
    res.status(403).json({ error: "Site management is disabled" });
    return;
  }
  const siteId = parseInt(req.params["id"] as string, 10);
  const session = (req as any).session?.user;
  const userId: number = session?.id ?? 0;
  const userIdStr: string = String(userId);
  const role: string = session?.role ?? "user";

  const [site] = await db.select(siteColumns).from(sitesTable).where(eq(sitesTable.id, siteId)).limit(1);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  const access = await canAccessSite(userId, userIdStr, role, siteId);
  if (!access || access === "member") { res.status(403).json({ error: "Forbidden" }); return; }

  await db.delete(sitesTable).where(eq(sitesTable.id, siteId));
  res.json({ ok: true });
});

// ── Siteimprove-style crawl management ───────────────────────────────────────

async function resolveManagedSite(req: Request, res: Response, siteId: number) {
  const session = (req as any).session?.user;
  const perms = await getEffectivePermissions(session?.id ?? 0, session?.role ?? "user");
  if (!perms.canManageSites) {
    res.status(403).json({ error: "Site management is disabled" });
    return null;
  }
  const [site] = await db.select(siteColumns).from(sitesTable).where(eq(sitesTable.id, siteId)).limit(1);
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return null;
  }
  const access = await canAccessSite(session?.id ?? 0, String(session?.id ?? 0), session?.role ?? "user", siteId);
  if (!access) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return site;
}

async function resolveAccessibleSite(req: Request, res: Response, siteId: number) {
  const session = (req as any).session?.user;
  const [site] = await db.select(siteColumns).from(sitesTable).where(eq(sitesTable.id, siteId)).limit(1);
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return null;
  }
  const access = await canAccessSite(
    session?.id ?? 0,
    String(session?.id ?? 0),
    session?.role ?? "user",
    siteId,
  );
  if (!access) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return site;
}

async function resolveCrawlHistorySite(req: Request, res: Response, siteId: number) {
  const site = await resolveAccessibleSite(req, res, siteId);
  if (!site) return null;
  const sessionUser = (req as any).session?.user;
  const perms = await getEffectivePermissions(sessionUser?.id ?? 0, sessionUser?.role ?? "user");
  if (!perms.canViewCrawlHistory) {
    res.status(403).json({ error: "Crawler history access is disabled" });
    return null;
  }
  return site;
}

async function canViewAccessibilityDashboard(req: Request, res: Response, siteId: number): Promise<boolean> {
  const sessionUser = (req as any).session?.user;
  const access = await canAccessSite(
    sessionUser?.id ?? 0,
    String(sessionUser?.id ?? 0),
    sessionUser?.role ?? "user",
    siteId,
  );
  if (!access) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  const perms = await getEffectivePermissions(sessionUser?.id ?? 0, sessionUser?.role ?? "user");
  if (!perms.canViewSiteAccessibilityDashboard) {
    res.status(403).json({ error: "Site accessibility dashboard access is disabled" });
    return false;
  }
  return true;
}

function nextScheduleDate(intervalDays: number, from = new Date()): Date {
  return new Date(from.getTime() + Math.max(1, intervalDays) * 24 * 60 * 60 * 1000);
}

function cleanRuleInput(body: any) {
  const ruleType = String(body?.ruleType ?? "").trim();
  const pattern = String(body?.pattern ?? "").trim();
  const patternType = String(body?.patternType ?? "contains").trim();
  if (!["include", "exclude", "remove_link", "remove_selector"].includes(ruleType)) {
    return { error: "ruleType must be include, exclude, remove_link, or remove_selector" };
  }
  if (!pattern) return { error: "pattern is required" };
  if (!["contains", "exact", "regex", "glob"].includes(patternType)) {
    return { error: "patternType must be contains, exact, regex, or glob" };
  }
  if (patternType === "regex") {
    try { new RegExp(pattern); } catch { return { error: "pattern is not a valid regular expression" }; }
  }
  return {
    data: {
      ruleType,
      pattern,
      patternType,
      note: typeof body?.note === "string" ? body.note.trim() || null : null,
      enabled: body?.enabled !== false,
    },
  };
}

router.get("/sites/:id/overview", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = Number(req.params["id"]);
  const site = await resolveCrawlHistorySite(req, res, siteId);
  if (!site) return;
  const client = await pool.connect();
  try {
    // Use one connection sequentially. pg clients cannot safely execute
    // concurrent queries, and Promise.all here produced a deprecation warning.
    const latest = await client.query(
      `SELECT id, status, created_at AS "createdAt", completed_at AS "completedAt",
              total_discovered AS "totalDiscovered", total_scanned AS "totalScanned",
              total_failed AS "totalFailed", total_skipped AS "totalSkipped",
              total_issues AS "totalIssues", broken_links_count AS "brokenLinksCount",
              scan_session_id AS "scanSessionId"
         FROM crawler_sessions
        WHERE site_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [siteId],
    );
    const history = await client.query(
      `SELECT id, status, created_at AS "createdAt", completed_at AS "completedAt",
              total_discovered AS "totalDiscovered", total_scanned AS "totalScanned",
              total_failed AS "totalFailed", total_skipped AS "totalSkipped",
              total_issues AS "totalIssues", broken_links_count AS "brokenLinksCount",
              scan_session_id AS "scanSessionId"
         FROM crawler_sessions
        WHERE site_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [siteId],
    );
    const counts = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE cp.status IN ('completed','skipped'))::int AS pages,
         COUNT(*) FILTER (WHERE cp.status = 'failed')::int AS failed_pages,
         COUNT(*) FILTER (WHERE cp.status = 'broken')::int AS broken_pages,
         COUNT(*)::int AS discovered,
         COALESCE((SELECT COUNT(*) FROM qa_links ql WHERE ql.scan_id = cs.scan_session_id), 0)::int AS links,
         (COALESCE((SELECT COUNT(*) FROM qa_images qi WHERE qi.scan_id = cs.scan_session_id), 0)
           + COALESCE((SELECT COUNT(*) FROM qa_links ql WHERE ql.scan_id = cs.scan_session_id), 0))::int AS asset_count
       FROM crawler_sessions cs
       LEFT JOIN crawler_pages cp ON cp.session_id = cs.id
       WHERE cs.site_id = $1
         AND cs.id = (SELECT id FROM crawler_sessions WHERE site_id = $1 ORDER BY created_at DESC LIMIT 1)
       GROUP BY cs.id, cs.scan_session_id`,
      [siteId],
    );
    const latestSession = latest.rows[0] ?? null;
    const metricRow = counts.rows[0] ?? {};
    const latestCompleted = history.rows.find((row) => row.status === "completed");
    const status = site.lifecycleStatus === "disabled"
      ? "disabled"
      : latestSession && ["pending", "discovering", "crawled", "scanning", "processing"].includes(latestSession.status)
        ? latestSession.status
        : latestSession?.status ?? "idle";
    res.json({
      site: {
        ...site,
        nextCrawlAt: site.nextCrawlAt,
        scheduleEnabled: site.scheduleEnabled,
        scheduleIntervalDays: site.scheduleIntervalDays,
      },
      overview: {
        status,
        lastCompletedAt: site.lastCompletedAt ?? latestCompleted?.completedAt ?? null,
        nextCrawlAt: site.nextCrawlAt,
        pages: Number(metricRow.pages ?? 0),
        links: Number(metricRow.links ?? 0),
        failedPages: Number(metricRow.failed_pages ?? 0),
        assetCount: Number(metricRow.asset_count ?? 0),
        latestSession,
      },
      history: history.rows,
    });
  } finally {
    client.release();
  }
});

router.get("/sites/:id/rules", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = Number(req.params["id"]);
  if (!await resolveManagedSite(req, res, siteId)) return;
  const rules = await db.select(siteContentRuleColumns).from(siteContentRulesTable)
    .where(eq(siteContentRulesTable.siteId, siteId))
    .orderBy(siteContentRulesTable.id);
  res.json({ rules });
});

router.get("/sites/:id/url-events", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = Number(req.params["id"]);
  if (!await resolveManagedSite(req, res, siteId)) return;
  const sessionId = req.query["sessionId"] ? Number(req.query["sessionId"]) : null;
  const disposition = typeof req.query["disposition"] === "string" ? req.query["disposition"] : null;
  const limit = Math.min(500, Math.max(1, Number(req.query["limit"] ?? 100)));
  const offset = Math.max(0, Number(req.query["offset"] ?? 0));

  const conditions = [
    eq(crawlerSessionsTable.siteId, siteId),
    ...(sessionId ? [eq(crawlerUrlEventsTable.sessionId, sessionId)] : []),
    ...(disposition ? [eq(crawlerUrlEventsTable.disposition, disposition)] : []),
  ];
  const events = await db.select({
    id: crawlerUrlEventsTable.id,
    sessionId: crawlerUrlEventsTable.sessionId,
    url: crawlerUrlEventsTable.url,
    disposition: crawlerUrlEventsTable.disposition,
    reason: crawlerUrlEventsTable.reason,
    sourceUrl: crawlerUrlEventsTable.sourceUrl,
    ruleId: crawlerUrlEventsTable.ruleId,
    createdAt: crawlerUrlEventsTable.createdAt,
  })
    .from(crawlerUrlEventsTable)
    .innerJoin(crawlerSessionsTable, eq(crawlerUrlEventsTable.sessionId, crawlerSessionsTable.id))
    .where(and(...conditions))
    .orderBy(desc(crawlerUrlEventsTable.createdAt))
    .limit(limit)
    .offset(offset);
  res.json({ events, limit, offset });
});

router.post("/sites/:id/rules", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = Number(req.params["id"]);
  const site = await resolveManagedSite(req, res, siteId);
  if (!site) return;
  const parsed = cleanRuleInput(req.body);
  if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
  const [rule] = await db.insert(siteContentRulesTable).values({
    siteId,
    ...parsed.data!,
    createdBy: String((req as any).session?.user?.id ?? ""),
  }).returning();
  res.status(201).json(rule);
});

router.put("/sites/:id/rules/:ruleId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = Number(req.params["id"]);
  if (!await resolveManagedSite(req, res, siteId)) return;
  const ruleId = Number(req.params["ruleId"]);
  const parsed = cleanRuleInput(req.body);
  if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
  const [rule] = await db.update(siteContentRulesTable)
    .set({ ...parsed.data!, updatedAt: new Date() })
    .where(and(eq(siteContentRulesTable.id, ruleId), eq(siteContentRulesTable.siteId, siteId)))
    .returning();
  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
  res.json(rule);
});

router.delete("/sites/:id/rules/:ruleId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = Number(req.params["id"]);
  if (!await resolveManagedSite(req, res, siteId)) return;
  const deleted = await db.delete(siteContentRulesTable)
    .where(and(eq(siteContentRulesTable.id, Number(req.params["ruleId"])), eq(siteContentRulesTable.siteId, siteId)))
    .returning({ id: siteContentRulesTable.id });
  if (deleted.length === 0) { res.status(404).json({ error: "Rule not found" }); return; }
  res.json({ ok: true });
});

router.put("/sites/:id/settings", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = Number(req.params["id"]);
  const site = await resolveManagedSite(req, res, siteId);
  if (!site) return;
  const body = req.body ?? {};
  const allowedScopes = ["all-subdomains", "subdomain", "subfolder", "exact-url"];
  const updates: any = { updatedAt: new Date() };
  if (typeof body.defaultScope === "string" && allowedScopes.includes(body.defaultScope)) updates.defaultScope = body.defaultScope;
  if (typeof body.sitemapUrl === "string" || body.sitemapUrl === null) updates.sitemapUrl = body.sitemapUrl;
  if (typeof body.crawlType === "string" && ["standard", "javascript", "fast"].includes(body.crawlType)) updates.crawlType = body.crawlType;
  if (typeof body.maxPages === "number") updates.maxPages = Math.min(100000, Math.max(1, Math.floor(body.maxPages)));
  if (typeof body.maxDepth === "number") updates.maxDepth = Math.min(20, Math.max(0, Math.floor(body.maxDepth)));
  if (typeof body.respectRobotsTxt === "boolean") updates.respectRobotsTxt = body.respectRobotsTxt;
  if (typeof body.assetMode === "string" && ["all", "images_only", "none"].includes(body.assetMode)) updates.assetMode = body.assetMode;
  if (typeof body.timezone === "string" && body.timezone.trim()) updates.timezone = body.timezone.trim();
  if (typeof body.scheduleIntervalDays === "number") updates.scheduleIntervalDays = Math.min(365, Math.max(1, Math.floor(body.scheduleIntervalDays)));
  if (typeof body.scheduleEnabled === "boolean") {
    updates.scheduleEnabled = body.scheduleEnabled;
    updates.nextCrawlAt = body.scheduleEnabled
      ? nextScheduleDate(updates.scheduleIntervalDays ?? site.scheduleIntervalDays)
      : null;
  }
  const [updated] = await db.update(sitesTable).set(updates).where(eq(sitesTable.id, siteId)).returning();
  res.json(updated);
});

router.post("/sites/:id/run-now", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = Number(req.params["id"]);
  const site = await resolveAccessibleSite(req, res, siteId);
  if (!site) return;
  const sessionUser = (req as any).session?.user;
  const perms = await getEffectivePermissions(sessionUser?.id ?? 0, sessionUser?.role ?? "user");
  if (!perms.canCreateCrawl) {
    res.status(403).json({ error: "Crawl creation is disabled" });
    return;
  }
  const rules = await db.select(siteContentRuleColumns).from(siteContentRulesTable)
    .where(and(eq(siteContentRulesTable.siteId, siteId), eq(siteContentRulesTable.enabled, true)))
    .orderBy(siteContentRulesTable.id);
  const sessionName = `${site.name} — ${new Date().toISOString().slice(0, 10)}`;
  const config: CrawlerConfig = {
    seedUrls: [site.baseUrl],
    sitemapUrl: site.sitemapUrl ?? undefined,
    maxPages: site.maxPages,
    maxDepth: site.maxDepth,
    respectRobotsTxt: site.respectRobotsTxt,
    useSitemap: Boolean(site.sitemapUrl) || true,
    followLinks: true,
    stayOnDomain: true,
    crawlScope: site.defaultScope as CrawlerConfig["crawlScope"],
    autoScan: true,
    blockAssets: site.assetMode === "none",
    tabPoolSize: 1,
    scanDelayMs: 10000,
    authenticated: false,
    incremental: false,
    detectBrokenLinks: true,
    siteId,
    timezone: site.timezone,
    assetMode: site.assetMode,
    contentRules: rules,
  };
  const [session] = await db.insert(crawlerSessionsTable).values({
    userId: String((req as any).session?.user?.id ?? ""),
    siteId,
    name: sessionName,
    seedUrl: site.baseUrl,
    status: "pending",
    lifecycleStatus: "queued",
    config,
  }).returning();
  await db.update(sitesTable).set({ lifecycleStatus: "crawling", updatedAt: new Date() }).where(eq(sitesTable.id, siteId));
  void startCrawlerJob(session.id).catch(() => {});
  res.status(202).json({ ok: true, sessionId: session.id });
});

// ── Accessibility Dashboard ──────────────────────────────────────────────────

// GET /api/sites/:id/dashboard
// Returns score, coverage, impact breakdown, top issues for the latest completed crawler session
router.get("/sites/:id/dashboard", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  if (!await canViewAccessibilityDashboard(req, res, siteId)) return;
  const client = await pool.connect();
  try {
    const [siteRow] = await db.select(siteColumns).from(sitesTable).where(eq(sitesTable.id, siteId)).limit(1);
    if (!siteRow) { res.status(404).json({ error: "Site not found" }); return; }
    const targetSetting = await client.query<{ target_wcag_level: WcagTargetLevel }>(
      `SELECT target_wcag_level FROM sites WHERE id = $1`,
      [siteId],
    );
    const targetWcagLevel = targetSetting.rows[0]?.target_wcag_level ?? "AA";
    const site = { ...siteRow, targetWcagLevel };

    // Latest completed session with a linked scan
    const sessionRes = await client.query(
      `SELECT id as crawler_id, scan_session_id, total_scanned, total_discovered, total_issues,
              broken_links_count, completed_at, config
       FROM crawler_sessions
       WHERE site_id = $1 AND status = 'completed' AND scan_session_id IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`,
      [siteId],
    );
    if (sessionRes.rows.length === 0) {
      res.json({ site, session: null, score: null, coverage: null, impactBreakdown: [], topIssues: [] });
      return;
    }
    const session = sessionRes.rows[0];
    const rawPageGroup = typeof req.query["page_group"] === "string"
      ? req.query["page_group"].trim()
      : "";
    let pageGroup: string | null = null;
    if (rawPageGroup) {
      const knownGroup = await client.query(
        `SELECT 1 FROM crawler_pages
         WHERE session_id = $1
           AND COALESCE(page_type, 'General') = $2
         LIMIT 1`,
        [session.crawler_id, rawPageGroup],
      );
      if (knownGroup.rowCount === 0) {
        res.status(400).json({ error: "The selected page group was not found for this site" });
        return;
      }
      pageGroup = rawPageGroup;
    }
    const scopedPageCondition = `
      AND ($2::text IS NULL OR EXISTS (
        SELECT 1 FROM crawler_pages cp
        WHERE cp.session_id = $3
          AND cp.url = pr.url
          AND COALESCE(cp.page_type, 'General') = $2
      ))`;
    const scopedParams = [session.scan_session_id, pageGroup, session.crawler_id];
    const scopedPageCounts = await client.query<{ total_scanned: number; total_discovered: number; failed_pages: number }>(
      `SELECT
         COUNT(DISTINCT pr.id)::int AS total_scanned,
         COUNT(DISTINCT cp.id)::int AS total_discovered,
         COUNT(*) FILTER (WHERE cp.status IN ('failed', 'broken'))::int AS failed_pages
       FROM crawler_pages cp
       LEFT JOIN page_results pr ON pr.scan_id = $1 AND pr.url = cp.url
       WHERE cp.session_id = $3
         AND ($2::text IS NULL OR COALESCE(cp.page_type, 'General') = $2)`,
      scopedParams,
    );
    const scopedTotalScanned = scopedPageCounts.rows[0]?.total_scanned ?? 0;
    const scopedTotalDiscovered = scopedPageCounts.rows[0]?.total_discovered ?? 0;
    const executionRows = await client.query<{
      rule_id: string;
      status: "not-selected" | "not-applicable" | "executed" | "failed";
      execution_tier: "automatic" | "manual";
    }>(
      `SELECT rs.rule_id, rs.status, rs.execution_tier
         FROM rule_execution_statuses rs
         JOIN page_results pr ON pr.id = rs.page_result_id
         LEFT JOIN crawler_pages cp ON cp.session_id = $3 AND cp.url = pr.url
        WHERE pr.scan_id = $1
          AND ($2::text IS NULL OR COALESCE(cp.page_type, 'General') = $2)`,
      scopedParams,
    );
    const executionCoverage = aggregateRuleCoverage(
      executionRows.rows.map((row) => ({
        ruleId: row.rule_id,
        status: row.status,
        executionTier: row.execution_tier,
      })),
      scopedTotalScanned,
    );
    const denominatorRes = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM page_results pr
        WHERE pr.scan_id = $1 AND pr.status = 'completed'
          AND NOT EXISTS (SELECT 1 FROM rule_page_stats rps WHERE rps.page_result_id = pr.id)
          AND ($2::text IS NULL OR EXISTS (
            SELECT 1 FROM crawler_pages cp
             WHERE cp.session_id = $3 AND cp.url = pr.url
               AND COALESCE(cp.page_type, 'General') = $2
          ))`,
      scopedParams,
    );
    const carriedRes = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM page_results pr
        WHERE pr.scan_id = $1 AND pr.status = 'completed'
          AND pr.carried_forward = TRUE
          AND ($2::text IS NULL OR EXISTS (
            SELECT 1 FROM crawler_pages cp
             WHERE cp.session_id = $3 AND cp.url = pr.url
               AND COALESCE(cp.page_type, 'General') = $2
          ))`,
      scopedParams,
    );
    const manualUnresolved = executionCoverage.rules
      .filter((rule) => rule.executionTier === "manual")
      .reduce((sum, rule) => sum + rule.executed, 0);
    const potentialRes = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM accessibility_issues ai
         JOIN page_results pr ON pr.id = ai.page_id
        WHERE pr.scan_id = $1 AND ai.rule_type = 'Potential Issue'
          AND ($2::text IS NULL OR EXISTS (
            SELECT 1 FROM crawler_pages cp
             WHERE cp.session_id = $3 AND cp.url = pr.url
               AND COALESCE(cp.page_type, 'General') = $2
          ))`,
      scopedParams,
    );
    const confidence = classifyScanConfidence({
      totalPages: Math.max(scopedTotalScanned, scopedTotalDiscovered),
      completedPages: Math.max(0, scopedTotalScanned - Number(scopedPageCounts.rows[0]?.failed_pages ?? 0)),
      failedPages: Number(scopedPageCounts.rows[0]?.failed_pages ?? 0),
      automaticApplicabilityCoverage: executionCoverage.automaticApplicabilityCoverage,
      manualUnresolved,
      potentialUnresolved: Number(potentialRes.rows[0]?.n ?? 0),
      fallbackDenominatorPages: Number(denominatorRes.rows[0]?.n ?? 0),
      carriedForwardPages: Number(carriedRes.rows[0]?.n ?? 0),
    });

    // Impact breakdown
    const impactRes = await client.query(
      `SELECT ai.impact,
              COUNT(*)::int as occurrences,
              COUNT(DISTINCT ai.page_id)::int as pages_affected,
              COUNT(DISTINCT ai.rule_id)::int as distinct_rules
       FROM accessibility_issues ai
       JOIN page_results pr ON pr.id = ai.page_id
        WHERE pr.scan_id = $1 ${scopedPageCondition}
       GROUP BY ai.impact`,
      scopedParams,
    );

    // Per-rule aggregation — every rule gets its own weight (Mr) and deduction (Dr).
    // Joins rule_page_stats to get true element-level totalChecked for CRr when available.
    // This is the source of truth for both the level score cards and the overall score.
    const ruleAggRes = await client.query(
      `SELECT ai.rule_id, ai.impact,
              COALESCE(NULLIF(MAX(ai.wcag_level), ''), 'Best Practice') AS level,
              COUNT(*)::int AS occurrences,
              COUNT(DISTINCT ai.page_id)::int AS pages_affected,
              COALESCE(SUM(rps.total_checked), 0)::int AS total_checked
       FROM accessibility_issues ai
       JOIN page_results pr ON pr.id = ai.page_id
       LEFT JOIN rule_page_stats rps ON rps.page_result_id = pr.id AND rps.rule_id = ai.rule_id
        WHERE pr.scan_id = $1 ${scopedPageCondition}
       GROUP BY ai.rule_id, ai.impact`,
      scopedParams,
    );
    const ruleDeductions = ruleAggRes.rows.map((r: any) => ({
      level: r.level as string,
      deduction: ruleDeduction(
        r.level, r.impact, r.occurrences, r.pages_affected, scopedTotalScanned,
        r.total_checked > 0 ? r.total_checked : undefined,
      ),
    }));

    // Level-level display stats (occurrences / pages affected / distinct rules) for the UI cards.
    const levelStatsRes = await client.query(
      `SELECT
         COALESCE(NULLIF(ai.wcag_level, ''), 'Best Practice') AS level,
         COUNT(*)::int AS occurrences,
         COUNT(DISTINCT ai.page_id)::int AS pages_affected,
         COUNT(DISTINCT ai.rule_id)::int AS distinct_rules
       FROM accessibility_issues ai
       JOIN page_results pr ON pr.id = ai.page_id
        WHERE pr.scan_id = $1 ${scopedPageCondition}
       GROUP BY COALESCE(NULLIF(ai.wcag_level, ''), 'Best Practice')`,
      scopedParams,
    );

    const LEVEL_ORDER = ["A", "AA", "AAA", "WAI-ARIA", "Best Practice"];
    const levelStatsByLevel: Record<string, any> = Object.fromEntries(
      levelStatsRes.rows.map((r: any) => [r.level, r]),
    );
    const levelScores = LEVEL_ORDER
      .filter((level) => levelStatsByLevel[level])
      .map((level) => {
        const stats = levelStatsByLevel[level];
        const deduction = ruleDeductions
          .filter((r: any) => r.level === level)
          .reduce((s: number, r: any) => s + r.deduction, 0);
        return {
          level,
          score: Math.max(0, Math.min(100, +(100 - deduction).toFixed(1))),
          occurrences: stats.occurrences as number,
          pagesAffected: stats.pages_affected as number,
          distinctRules: stats.distinct_rules as number,
        };
      });

    // Overall score = 100 minus the sum of every rule's own deduction, across all levels.
    // No separate blending weights needed — each rule's level/severity weight already
    // reflects its relative importance.
    const targetLevels = scopedWcagLevels(targetWcagLevel);
    const totalRuleDeduction = ruleDeductions
      .filter((r: any) => targetLevels.includes(r.level))
      .reduce((s: number, r: any) => s + r.deduction, 0);
    const score = Math.max(0, Math.min(100, +(100 - totalRuleDeduction).toFixed(1)));

    const totalOccurrences = impactRes.rows.reduce((s: number, r: any) => s + r.occurrences, 0);
    const totalPagesWithIssues = (await client.query(
      `SELECT COUNT(DISTINCT page_id)::int as n FROM accessibility_issues ai
       JOIN page_results pr ON pr.id = ai.page_id WHERE pr.scan_id = $1 ${scopedPageCondition}`,
       scopedParams,
    )).rows[0].n;
    const distinctRules = (await client.query(
      `SELECT COUNT(DISTINCT rule_id)::int as n FROM accessibility_issues ai
       JOIN page_results pr ON pr.id = ai.page_id WHERE pr.scan_id = $1 ${scopedPageCondition}`,
       scopedParams,
    )).rows[0].n;

    // Top 5 issues (critical+serious) by score impact
    const topIssuesRes = await client.query(
      `SELECT ai.rule_id, MAX(ai.description) as description, ai.impact,
              MAX(ai.wcag_criteria) as wcag_criteria, MAX(ai.wcag_level) as wcag_level,
              COUNT(*)::int as occurrences, COUNT(DISTINCT ai.page_id)::int as pages_affected,
              ROUND(
                (${SQL_LEVEL_WEIGHT_CASE} * ${SQL_SEVERITY_WEIGHT_CASE})
                * LEAST(1, COUNT(DISTINCT ai.page_id)::numeric / GREATEST($4::numeric, 1))
                * LEAST(1, COUNT(*)::numeric / GREATEST($4::numeric, 1))
              , 2) as points_to_gain
       FROM accessibility_issues ai
       JOIN page_results pr ON pr.id = ai.page_id
        WHERE pr.scan_id = $1 ${scopedPageCondition} AND ai.impact IN ('critical','serious')
       GROUP BY ai.rule_id, ai.impact
       ORDER BY points_to_gain DESC, occurrences DESC
       LIMIT 5`,
        [session.scan_session_id, pageGroup, session.crawler_id, scopedTotalScanned],
    );

    // Top 5 potential issues (moderate+minor) by score impact
    const topPotentialIssuesRes = await client.query(
      `SELECT ai.rule_id, MAX(ai.description) as description, ai.impact,
              MAX(ai.wcag_criteria) as wcag_criteria, MAX(ai.wcag_level) as wcag_level,
              COUNT(*)::int as occurrences, COUNT(DISTINCT ai.page_id)::int as pages_affected,
              ROUND(
                (${SQL_LEVEL_WEIGHT_CASE} * ${SQL_SEVERITY_WEIGHT_CASE})
                * LEAST(1, COUNT(DISTINCT ai.page_id)::numeric / GREATEST($4::numeric, 1))
                * LEAST(1, COUNT(*)::numeric / GREATEST($4::numeric, 1))
              , 2) as points_to_gain
       FROM accessibility_issues ai
       JOIN page_results pr ON pr.id = ai.page_id
        WHERE pr.scan_id = $1 ${scopedPageCondition} AND ai.impact IN ('moderate','minor')
       GROUP BY ai.rule_id, ai.impact
       ORDER BY points_to_gain DESC, occurrences DESC
       LIMIT 5`,
        [session.scan_session_id, pageGroup, session.crawler_id, scopedTotalScanned],
    );

    // Resolved issues — rules in the previous scan that no longer appear in the current scan
    const prevSessionRes = await client.query(
      `SELECT id as crawler_id, scan_session_id, total_scanned FROM crawler_sessions
       WHERE site_id = $1 AND status = 'completed' AND scan_session_id IS NOT NULL
         AND id != $2
       ORDER BY completed_at DESC LIMIT 1`,
      [siteId, session.crawler_id],
    );
    let resolvedIssues: any[] = [];
    if (prevSessionRes.rows.length > 0) {
      const prev = prevSessionRes.rows[0];
      const resolvedRes = await client.query(
        `SELECT ai.rule_id, MAX(ai.description) as description, ai.impact,
                MAX(ai.wcag_criteria) as wcag_criteria, MAX(ai.wcag_level) as wcag_level,
                COUNT(*)::int as occurrences, COUNT(DISTINCT ai.page_id)::int as pages_affected,
                ROUND(
                  (${SQL_LEVEL_WEIGHT_CASE} * ${SQL_SEVERITY_WEIGHT_CASE})
                  * LEAST(1, COUNT(DISTINCT ai.page_id)::numeric / GREATEST($2::numeric, 1))
                  * LEAST(1, COUNT(*)::numeric / GREATEST($2::numeric, 1))
                , 2) as points_to_gain
         FROM accessibility_issues ai
         JOIN page_results pr ON pr.id = ai.page_id
         WHERE pr.scan_id = $1
           AND ai.rule_id NOT IN (
             SELECT DISTINCT ai2.rule_id FROM accessibility_issues ai2
             JOIN page_results pr2 ON pr2.id = ai2.page_id
             WHERE pr2.scan_id = $3
           )
         GROUP BY ai.rule_id, ai.impact
         ORDER BY points_to_gain DESC
         LIMIT 5`,
        [prev.scan_session_id, prev.total_scanned, session.scan_session_id],
      );
      resolvedIssues = resolvedRes.rows;
    }

    // Persist this session's score and compute delta vs previous scan
    await client.query(
      `INSERT INTO site_score_history (site_id, crawler_session_id, score, scanned_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (crawler_session_id) DO UPDATE SET score = EXCLUDED.score`,
      [siteId, session.crawler_id, score, session.completed_at ?? new Date()],
    );
    const prevScoreRes = await client.query(
      `SELECT score FROM site_score_history
       WHERE site_id = $1 AND crawler_session_id != $2
       ORDER BY scanned_at DESC LIMIT 1`,
      [siteId, session.crawler_id],
    );
    const previousScore: number | null = prevScoreRes.rows.length > 0 ? +prevScoreRes.rows[0].score : null;
    const scoreDelta: number | null = previousScore !== null ? +(score - previousScore).toFixed(1) : null;

    res.json({
      site,
      session: {
        crawlerId: session.crawler_id,
        completedAt: session.completed_at,
        totalScanned: scopedTotalScanned,
        totalDiscovered: scopedTotalDiscovered,
        brokenLinksCount: session.broken_links_count,
      },
      score,
      scoreDelta,
      previousScore,
      coverage: {
        totalScanned: scopedTotalScanned,
        totalDiscovered: scopedTotalDiscovered,
        pagesWithIssues: totalPagesWithIssues,
        pagesWithoutIssues: Math.max(0, scopedTotalScanned - totalPagesWithIssues),
        totalOccurrences,
        distinctRules,
        brokenLinks: session.broken_links_count,
        ruleExecution: executionCoverage.rules,
        automaticApplicabilityCoverage: executionCoverage.automaticApplicabilityCoverage,
        confidence,
      },
      levelScores,
      impactBreakdown: impactRes.rows,
      topIssues: topIssuesRes.rows,
      topPotentialIssues: topPotentialIssuesRes.rows,
      resolvedIssues,
    });
  } finally {
    client.release();
  }
});

// PUT /api/sites/:id/target-score
// Target score editing is intentionally separate from site configuration access.
// Users and group members with the explicit permission can update an accessible site.
router.put("/sites/:id/target-score", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  const sessionUser = (req as any).session?.user;
  const access = await canAccessSite(
    sessionUser?.id ?? 0,
    String(sessionUser?.id ?? 0),
    sessionUser?.role ?? "user",
    siteId,
  );
  if (!access) { res.status(403).json({ error: "Forbidden" }); return; }

  const perms = await getEffectivePermissions(sessionUser?.id ?? 0, sessionUser?.role ?? "user");
  if (!perms.canManageSiteTargetScore) {
    res.status(403).json({ error: "Target score editing is disabled" });
    return;
  }

  const raw = req.body?.targetScore;
  const targetScore = raw === null || raw === "" || raw === undefined
    ? null
    : typeof raw === "number" ? raw : Number(raw);
  if (targetScore !== null && (!Number.isFinite(targetScore) || targetScore < 0 || targetScore > 100)) {
    res.status(400).json({ error: "targetScore must be between 0 and 100, or null" });
    return;
  }
  const rawTargetWcagLevel = req.body?.targetWcagLevel;
  const targetWcagLevel = rawTargetWcagLevel === undefined
    ? undefined
    : typeof rawTargetWcagLevel === "string" ? rawTargetWcagLevel.trim() : "";
  if (targetWcagLevel !== undefined && !WCAG_TARGET_LEVELS.includes(targetWcagLevel as WcagTargetLevel)) {
    res.status(400).json({ error: "targetWcagLevel must be A, AA, AAA, or All" });
    return;
  }

  const updated = await pool.query<{ id: number; target_score: number | null; target_wcag_level: WcagTargetLevel }>(
    `UPDATE sites
     SET target_score = $2,
         target_wcag_level = COALESCE($3::text, target_wcag_level),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, target_score, target_wcag_level`,
    [siteId, targetScore === null ? null : Math.round(targetScore), targetWcagLevel ?? null],
  );
  if (updated.rowCount === 0) { res.status(404).json({ error: "Site not found" }); return; }
  res.json({
    id: updated.rows[0].id,
    targetScore: updated.rows[0].target_score,
    targetWcagLevel: updated.rows[0].target_wcag_level,
  });
});

// GET /api/sites/:id/score-history
// Returns ordered list of {score, scanned_at} for every completed scan of this site
router.get("/sites/:id/score-history", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  if (!await canViewAccessibilityDashboard(req, res, siteId)) return;
  const client = await pool.connect();
  try {
    const latestSession = await client.query(
      `SELECT id AS crawler_id
       FROM crawler_sessions
       WHERE site_id = $1 AND status = 'completed' AND scan_session_id IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`,
      [siteId],
    );
    const latestCrawlerId = latestSession.rows[0]?.crawler_id;
    const pageGroupScope = latestCrawlerId
      ? await resolvePageGroupScope(client, latestCrawlerId, req.query["page_group"])
      : { value: null as string | null };
    if (pageGroupScope.error) { res.status(400).json({ error: pageGroupScope.error }); return; }
    const result = await client.query(
      `SELECT ssh.score::float AS score,
              cs.id AS crawler_id,
              cs.scan_session_id,
              COALESCE(cs.completed_at, ssh.scanned_at) AS scanned_at,
               COUNT(DISTINCT pr.id)::int AS total_scanned,
              COUNT(ai.id) FILTER (WHERE ai.impact IN ('critical','serious') AND COALESCE(NULLIF(ai.wcag_level,''),'Best Practice') = 'A')::int AS level_a_issues,
              COUNT(ai.id) FILTER (WHERE ai.impact IN ('critical','serious') AND COALESCE(NULLIF(ai.wcag_level,''),'Best Practice') = 'AA')::int AS level_aa_issues,
              COUNT(ai.id) FILTER (WHERE ai.impact IN ('critical','serious'))::int AS total_issues,
              COUNT(ai.id) FILTER (WHERE ai.impact IN ('moderate','minor') AND COALESCE(NULLIF(ai.wcag_level,''),'Best Practice') = 'A')::int AS level_a_potential,
              COUNT(ai.id) FILTER (WHERE ai.impact IN ('moderate','minor') AND COALESCE(NULLIF(ai.wcag_level,''),'Best Practice') = 'AA')::int AS level_aa_potential,
              COUNT(ai.id) FILTER (WHERE ai.impact IN ('moderate','minor'))::int AS total_potential_issues
       FROM site_score_history ssh
       JOIN crawler_sessions cs ON cs.id = ssh.crawler_session_id
       LEFT JOIN page_results pr ON pr.scan_id = cs.scan_session_id
        LEFT JOIN crawler_pages cp
          ON cp.session_id = cs.id AND cp.url = pr.url
         AND ($2::text IS NULL OR COALESCE(cp.page_type, 'General') = $2)
       LEFT JOIN accessibility_issues ai ON ai.page_id = pr.id
       WHERE ssh.site_id = $1
          AND ($2::text IS NULL OR cp.id IS NOT NULL)
        GROUP BY ssh.id, ssh.score, cs.id, cs.scan_session_id, cs.completed_at, ssh.scanned_at, cs.total_scanned
       ORDER BY COALESCE(cs.completed_at, ssh.scanned_at) ASC`,
       [siteId, pageGroupScope.value],
    );
    const history = pageGroupScope.value === null
      ? result.rows
      : await Promise.all(result.rows.map(async (row: any) => {
        const ruleRows = await client.query(
          `SELECT ai.rule_id, ai.impact,
                  COALESCE(NULLIF(MAX(ai.wcag_level), ''), 'Best Practice') AS level,
                  COUNT(*)::int AS occurrences,
                  COUNT(DISTINCT ai.page_id)::int AS pages_affected,
                  COALESCE(SUM(rps.total_checked), 0)::int AS total_checked
           FROM accessibility_issues ai
           JOIN page_results pr ON pr.id = ai.page_id
           LEFT JOIN rule_page_stats rps ON rps.page_result_id = pr.id AND rps.rule_id = ai.rule_id
           WHERE pr.scan_id = $1
             AND EXISTS (
               SELECT 1 FROM crawler_pages cp
               WHERE cp.session_id = $2 AND cp.url = pr.url
                 AND COALESCE(cp.page_type, 'General') = $3
             )
           GROUP BY ai.rule_id, ai.impact`,
          [row.scan_session_id, row.crawler_id, pageGroupScope.value],
        );
        const targetRes = await client.query<{ target_wcag_level: WcagTargetLevel }>(
          `SELECT target_wcag_level FROM sites WHERE id = $1`,
          [siteId],
        );
        const targetLevels = scopedWcagLevels(targetRes.rows[0]?.target_wcag_level ?? "AA");
        const totalScanned = Number(row.total_scanned) || 0;
        const deduction = ruleRows.rows
          .filter((rule: any) => targetLevels.includes(rule.level))
          .reduce((sum: number, rule: any) => sum + ruleDeduction(
            rule.level,
            rule.impact,
            Number(rule.occurrences),
            Number(rule.pages_affected),
            totalScanned,
            Number(rule.total_checked) > 0 ? Number(rule.total_checked) : undefined,
          ), 0);
        return { ...row, score: Math.max(0, Math.min(100, +(100 - deduction).toFixed(1))) };
      }));
    res.json({ history });
  } finally {
    client.release();
  }
});

// GET /api/sites/:id/page-groups
// Returns per page-type accessibility breakdown
router.get("/sites/:id/page-groups", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  if (!await canViewAccessibilityDashboard(req, res, siteId)) return;
  const client = await pool.connect();
  try {
    const [sessionRes, preferencesRes] = await Promise.all([
      client.query(
      `SELECT id as crawler_id, scan_session_id, total_scanned
       FROM crawler_sessions
       WHERE site_id = $1 AND status = 'completed' AND scan_session_id IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`,
      [siteId],
      ),
      client.query<{ page_type: string }>(
        `SELECT page_type FROM site_page_group_preferences WHERE site_id = $1`,
        [siteId],
      ),
    ]);
    if (sessionRes.rows.length === 0) {
      res.json({
        groups: preferencesRes.rows.map((preference) => emptyPageGroup(preference.page_type)),
        totalScanned: 0,
      });
      return;
    }
    const session = sessionRes.rows[0];

    const groupsRes = await client.query(
      `SELECT
         COALESCE(cp.page_type, 'General') as page_type,
         COUNT(DISTINCT cp.id)::int as pages,
         COUNT(DISTINCT CASE WHEN cp.status = 'completed' THEN cp.id END)::int as scanned_pages,
         COUNT(DISTINCT CASE WHEN ai.id IS NOT NULL THEN cp.id END)::int as pages_with_issues,
         COUNT(DISTINCT CASE WHEN ai.impact IN ('critical','serious') THEN cp.id END)::int as pages_with_critical,
         COUNT(ai.id)::int as total_occurrences,
         COUNT(DISTINCT ai.rule_id)::int as distinct_rules,
         COUNT(CASE WHEN ai.impact IN ('critical','serious') THEN 1 END)::int as issues_count,
         COUNT(CASE WHEN ai.impact IN ('moderate','minor') THEN 1 END)::int as potential_issues_count,
         COALESCE(SUM(
           CASE ai.impact
             WHEN 'critical' THEN 2.5
             WHEN 'serious'  THEN 1.5
             WHEN 'moderate' THEN 0.5
             ELSE 0.25
           END
         ), 0)::numeric as weighted_sum
       FROM crawler_pages cp
       LEFT JOIN page_results pr ON pr.url = cp.url AND pr.scan_id = $2
       LEFT JOIN accessibility_issues ai ON ai.page_id = pr.id
        WHERE cp.session_id = $1
       GROUP BY COALESCE(cp.page_type, 'General')
       ORDER BY pages DESC`,
      [session.crawler_id, session.scan_session_id],
    );

    // Quick per-page-type score — same severity weights as the site-wide model, averaged
    // per page in the group (this view has no per-rule/level breakdown, so it's a lighter
    // approximation used only for relative comparison between page types).
    const totalScanned = session.total_scanned;
    function groupScore(weightedSum: number, scannedPages: number): number | null {
      if (scannedPages === 0) return null;
      return Math.max(0, Math.min(100, +(100 - (weightedSum / scannedPages) / 2.5).toFixed(1)));
    }
    const groupsByType = new Map<string, any>();
    for (const group of groupsRes.rows) {
      const score = groupScore(+group.weighted_sum, group.scanned_pages);
      groupsByType.set(group.page_type, {
        ...group,
        score,
        points_to_target: score === null
          ? null
          : +(Math.max(0, 80 - score) * group.scanned_pages / Math.max(totalScanned, 1)).toFixed(2),
      });
    }
    // A saved preference must remain reachable even when its page type is not
    // present in the newest crawl, so users can always include it again.
    for (const preference of preferencesRes.rows) {
      if (!groupsByType.has(preference.page_type)) {
        groupsByType.set(preference.page_type, emptyPageGroup(preference.page_type));
      }
    }
    const groups = Array.from(groupsByType.values());

    res.json({ groups, totalScanned });
  } finally {
    client.release();
  }
});

function emptyPageGroup(pageType: string) {
  return {
    page_type: pageType,
    pages: 0,
    scanned_pages: 0,
    pages_with_issues: 0,
    pages_with_critical: 0,
    total_occurrences: 0,
    distinct_rules: 0,
    issues_count: 0,
    potential_issues_count: 0,
    weighted_sum: 0,
    score: null,
    points_to_target: null,
  };
}

// GET /api/sites/:id/page-group-preferences
// Returns explicitly saved choices only. Every newly discovered group defaults
// to included, so a future crawl never loses coverage without user intent.
router.get("/sites/:id/page-group-preferences", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  if (!await canViewAccessibilityDashboard(req, res, siteId)) return;

  const result = await pool.query<{ page_type: string; include_in_scan: boolean }>(
    `SELECT page_type, include_in_scan
     FROM site_page_group_preferences
     WHERE site_id = $1`,
    [siteId],
  );
  res.json({
    preferences: Object.fromEntries(
      result.rows.map((row) => [row.page_type, row.include_in_scan]),
    ),
  });
});

// PUT /api/sites/:id/page-group-preferences
// Page Group coverage affects future crawl accessibility phases, so changing it
// follows the same capability boundary as creating a crawl.
router.put("/sites/:id/page-group-preferences", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  if (!await canViewAccessibilityDashboard(req, res, siteId)) return;

  const sessionUser = (req as any).session?.user;
  const perms = await getEffectivePermissions(sessionUser?.id ?? 0, sessionUser?.role ?? "user");
  if (!perms.canCreateCrawl) {
    res.status(403).json({ error: "You do not have permission to change scan coverage" });
    return;
  }

  const pageType = typeof req.body?.pageType === "string" ? req.body.pageType.trim() : "";
  const included = req.body?.included;
  if (!pageType || pageType.length > 160 || typeof included !== "boolean") {
    res.status(400).json({ error: "pageType and included are required" });
    return;
  }

  // Only accept categories actually discovered for this site; this prevents
  // arbitrary input and lets obsolete categories naturally disappear from UI.
  const knownGroup = await pool.query(
    `SELECT 1
     FROM crawler_pages cp
     JOIN crawler_sessions cs ON cs.id = cp.session_id
     WHERE cs.site_id = $1
       AND COALESCE(cp.page_type, 'General') = $2
     LIMIT 1`,
    [siteId, pageType],
  );
  if (knownGroup.rowCount === 0) {
    res.status(400).json({ error: "This page group has not been discovered for the selected site" });
    return;
  }

  await pool.query(
    `INSERT INTO site_page_group_preferences (site_id, page_type, include_in_scan, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (site_id, page_type)
     DO UPDATE SET include_in_scan = EXCLUDED.include_in_scan, updated_at = NOW()`,
    [siteId, pageType, included],
  );
  res.json({ pageType, included });
});

// GET /api/sites/:id/issues
//   ?type=issues|potential   — issues → critical+serious; potential → moderate+minor
//   &impact=critical|serious|moderate|minor   — narrow to one impact within the type
//   &wcag_level=A|AA|AAA     — narrow by WCAG conformance level
//   &search=<text>           — search in description or rule_id
//   &page=1 &limit=50
router.get("/sites/:id/issues", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  if (!await canViewAccessibilityDashboard(req, res, siteId)) return;
  const type = (req.query["type"] as string) ?? "issues";
  const page = Math.max(1, parseInt(req.query["page"] as string || "1", 10));
  const limit = Math.min(100, parseInt(req.query["limit"] as string || "50", 10));
  const offset = (page - 1) * limit;

  const typeImpacts = type === "potential" ? ["moderate", "minor"] : ["critical", "serious"];
  const filterImpact = req.query["impact"] as string | undefined;
  const impacts = filterImpact && typeImpacts.includes(filterImpact) ? [filterImpact] : typeImpacts;

  const rawWcag = req.query["wcag_level"] as string | undefined;
  const wcagLevel: string | null = rawWcag && ["A", "AA", "AAA"].includes(rawWcag) ? rawWcag : null;

  const rawSearch = req.query["search"] as string | undefined;
  const search: string | null = rawSearch && rawSearch.trim() ? rawSearch.trim() : null;

  const client = await pool.connect();
  try {
    const sessionRes = await client.query(
      `SELECT scan_session_id, total_scanned FROM crawler_sessions
       WHERE site_id = $1 AND status = 'completed' AND scan_session_id IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`,
      [siteId],
    );
    if (sessionRes.rows.length === 0) {
      res.json({ issues: [], total: 0, totalOccurrences: 0, page, limit });
      return;
    }
    const { scan_session_id, total_scanned, crawler_id } = sessionRes.rows[0];
    const pageGroupScope = await resolvePageGroupScope(client, crawler_id, req.query["page_group"]);
    if (pageGroupScope.error) { res.status(400).json({ error: pageGroupScope.error }); return; }

    // Single CTE query — window functions give totals without a second round-trip
    const result = await client.query(
      `WITH grouped AS (
         SELECT ai.rule_id, ai.impact,
                MAX(ai.description)    AS description,
                MAX(ai.wcag_criteria)  AS wcag_criteria,
                MAX(ai.wcag_level)     AS wcag_level,
                COUNT(*)::int          AS occurrences,
                COUNT(DISTINCT ai.page_id)::int AS pages_affected,
                ROUND(
                  (${SQL_LEVEL_WEIGHT_CASE} * ${SQL_SEVERITY_WEIGHT_CASE})
                  * LEAST(1, COUNT(DISTINCT ai.page_id)::numeric / GREATEST($3::numeric, 1))
                  * LEAST(1, COUNT(*)::numeric / GREATEST($3::numeric, 1))
                , 2) AS points_to_gain
         FROM accessibility_issues ai
         JOIN page_results pr ON pr.id = ai.page_id
         WHERE pr.scan_id = $1
           AND ai.impact = ANY($2)
            AND ($6::text IS NULL OR EXISTS (
              SELECT 1 FROM crawler_pages cp
              WHERE cp.session_id = $7 AND cp.url = pr.url
                AND COALESCE(cp.page_type, 'General') = $6
            ))
           AND ($5::text IS NULL
                OR ai.description ILIKE '%' || $5 || '%'
                OR ai.rule_id ILIKE '%' || $5 || '%')
         GROUP BY ai.rule_id, ai.impact
       ),
       filtered AS (
         SELECT * FROM grouped
         WHERE ($4::text IS NULL OR wcag_level = $4)
       ),
       totals AS (
         SELECT COUNT(*)::int           AS total_rules,
                COALESCE(SUM(occurrences), 0)::int AS total_occurrences
         FROM filtered
       ),
       paged AS (
         SELECT filtered.*
         FROM filtered
         ORDER BY points_to_gain DESC, occurrences DESC
          LIMIT $8 OFFSET $9
       )
       SELECT paged.*, totals.total_rules, totals.total_occurrences
       FROM paged
       CROSS JOIN totals`,
       [scan_session_id, impacts, total_scanned, wcagLevel, search, pageGroupScope.value, crawler_id, limit, offset],
    );

    const total = result.rows[0]?.total_rules ?? 0;
    const totalOccurrences = result.rows[0]?.total_occurrences ?? 0;
    res.json({
      issues: result.rows,
      total: +total,
      totalOccurrences: +totalOccurrences,
      page,
      limit,
    });
  } finally {
    client.release();
  }
});

// GET /api/sites/:id/pages-with-issues
// Returns affected pages from the latest completed scan, grouped with issue
// occurrence counts. The default scope matches the Issues page (critical /
// serious); ?type=potential switches to moderate / minor.
router.get("/sites/:id/pages-with-issues", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  if (!await canViewAccessibilityDashboard(req, res, siteId)) return;

  const type = (req.query["type"] as string) === "potential" ? "potential" : "issues";
  const impacts = type === "potential" ? ["moderate", "minor"] : ["critical", "serious"];
  const page = Math.max(1, parseInt(req.query["page"] as string || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query["limit"] as string || "25", 10)));
  const offset = (page - 1) * limit;
  const search = (req.query["search"] as string | undefined)?.trim() || null;

  const client = await pool.connect();
  try {
    const sessionRes = await client.query(
      `SELECT id as crawler_id, scan_session_id, completed_at
       FROM crawler_sessions
       WHERE site_id = $1 AND status = 'completed' AND scan_session_id IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`,
      [siteId],
    );
    if (sessionRes.rows.length === 0) {
      res.json({ pages: [], total: 0, totalOccurrences: 0, page, limit, type });
      return;
    }

    const scanId = sessionRes.rows[0].scan_session_id;
    const pageGroupScope = await resolvePageGroupScope(client, sessionRes.rows[0].crawler_id, req.query["page_group"]);
    if (pageGroupScope.error) { res.status(400).json({ error: pageGroupScope.error }); return; }
    const result = await client.query(
      `WITH grouped AS (
         SELECT pr.id AS page_id,
                pr.url,
                COALESCE(
                  NULLIF(
                    btrim((regexp_match(pr.page_html, '(?is)<title[^>]*>([^<]*)</title\s*>'))[1]),
                    ''
                  ),
                  ''
                ) AS page_title,
                COUNT(ai.id)::int AS issue_count,
                COUNT(DISTINCT ai.rule_id)::int AS rule_count,
                MAX(pr.scanned_at) AS scanned_at
         FROM page_results pr
         JOIN accessibility_issues ai ON ai.page_id = pr.id
         WHERE pr.scan_id = $1
           AND ai.impact = ANY($2)
            AND ($6::text IS NULL OR EXISTS (
              SELECT 1 FROM crawler_pages cp
              WHERE cp.session_id = $7 AND cp.url = pr.url
                AND COALESCE(cp.page_type, 'General') = $6
            ))
           AND ($3::text IS NULL OR pr.url ILIKE '%' || $3 || '%')
         GROUP BY pr.id, pr.url, pr.page_html
       ),
       totals AS (
         SELECT COUNT(*)::int AS total_pages,
                COALESCE(SUM(issue_count), 0)::int AS total_occurrences
         FROM grouped
       )
       SELECT grouped.*, totals.total_pages, totals.total_occurrences
       FROM grouped CROSS JOIN totals
       ORDER BY issue_count DESC, url ASC
       LIMIT $4 OFFSET $5`,
       [scanId, impacts, search, limit, offset, pageGroupScope.value, sessionRes.rows[0].crawler_id],
    );

    const first = result.rows[0];
    res.json({
      pages: result.rows.map((row: any) => ({
        pageId: row.page_id,
        url: row.url,
        title: row.page_title || null,
        issueCount: row.issue_count,
        ruleCount: row.rule_count,
        scannedAt: row.scanned_at,
      })),
      total: +(first?.total_pages ?? 0),
      totalOccurrences: +(first?.total_occurrences ?? 0),
      page,
      limit,
      type,
      scanId,
    });
  } finally {
    client.release();
  }
});

// GET /api/sites/:id/issues/:ruleId
//   ?page=1 &limit=25 &search=<url-text> &sort=occurrences|url
router.get("/sites/:id/issues/:ruleId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  if (!await canViewAccessibilityDashboard(req, res, siteId)) return;
  const ruleId = decodeURIComponent(req.params["ruleId"] as string);
  const page  = Math.max(1, parseInt(req.query["page"]  as string || "1",  10));
  const limit = Math.min(200, parseInt(req.query["limit"] as string || "25", 10));
  const offset = (page - 1) * limit;
  const rawSearch = req.query["search"] as string | undefined;
  const search: string | null = rawSearch?.trim() || null;
  const sort = (req.query["sort"] as string) === "url" ? "url" : "occurrences";

  const client = await pool.connect();
  try {
    // Resolve latest session
    const sessRes = await client.query(
      `SELECT scan_session_id, total_scanned, id as crawler_id
       FROM crawler_sessions
       WHERE site_id = $1 AND status = 'completed' AND scan_session_id IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`,
      [siteId],
    );
    if (sessRes.rows.length === 0) { res.status(404).json({ error: "No completed session found" }); return; }
    const { scan_session_id, total_scanned, crawler_id } = sessRes.rows[0];
    const pageGroupScope = await resolvePageGroupScope(client, crawler_id, req.query["page_group"]);
    if (pageGroupScope.error) { res.status(400).json({ error: pageGroupScope.error }); return; }

    // Rule summary
    const ruleRes = await client.query(
      `SELECT ai.rule_id, MAX(ai.description) as description, ai.impact,
              MAX(ai.wcag_criteria) as wcag_criteria, MAX(ai.wcag_level) as wcag_level,
              MAX(ai.legal_text) as legal_text, MAX(ai.remediation) as remediation,
              COUNT(*)::int as total_occurrences,
              COUNT(DISTINCT ai.page_id)::int as pages_affected,
              ROUND(
                (${SQL_LEVEL_WEIGHT_CASE} * ${SQL_SEVERITY_WEIGHT_CASE})
                * LEAST(1, COUNT(DISTINCT ai.page_id)::numeric / GREATEST($2::numeric, 1))
                * LEAST(1, COUNT(*)::numeric / GREATEST($2::numeric, 1))
              , 2) as points_to_gain
       FROM accessibility_issues ai
       JOIN page_results pr ON pr.id = ai.page_id
        WHERE pr.scan_id = $1 AND ai.rule_id = $3
          AND ($4::text IS NULL OR EXISTS (
            SELECT 1 FROM crawler_pages cp
            WHERE cp.session_id = $5 AND cp.url = pr.url
              AND COALESCE(cp.page_type, 'General') = $4
          ))
       GROUP BY ai.rule_id, ai.impact`,
       [scan_session_id, total_scanned, ruleId, pageGroupScope.value, crawler_id],
    );
    if (ruleRes.rows.length === 0) { res.status(404).json({ error: "Rule not found in this site's scan" }); return; }

    // Sample affected elements (up to 5, prefer those with context)
    const samplesRes = await client.query(
      `SELECT pr.url, ai.element, ai.element_context, ai.selector
       FROM accessibility_issues ai
       JOIN page_results pr ON pr.id = ai.page_id
        WHERE pr.scan_id = $1 AND ai.rule_id = $2
          AND ($3::text IS NULL OR EXISTS (
            SELECT 1 FROM crawler_pages cp
            WHERE cp.session_id = $4 AND cp.url = pr.url
              AND COALESCE(cp.page_type, 'General') = $3
          ))
         AND ai.element_context IS NOT NULL AND ai.element_context <> ''
       LIMIT 5`,
       [scan_session_id, ruleId, pageGroupScope.value, crawler_id],
    );

    // Pages list with counts
    const orderClause = sort === "url" ? "pr.url ASC" : "occurrences DESC";
    const pagesRes = await client.query(
      `WITH page_counts AS (
         SELECT pr.id AS page_id, pr.url,
                COUNT(ai.id)::int AS occurrences
         FROM page_results pr
         JOIN accessibility_issues ai ON ai.page_id = pr.id
         WHERE pr.scan_id = $1 AND ai.rule_id = $2
            AND ($6::text IS NULL OR EXISTS (
              SELECT 1 FROM crawler_pages cp
              WHERE cp.session_id = $7 AND cp.url = pr.url
                AND COALESCE(cp.page_type, 'General') = $6
            ))
           AND ($3::text IS NULL OR pr.url ILIKE '%' || $3 || '%')
         GROUP BY pr.id, pr.url
       ),
       total AS (SELECT COUNT(*)::int AS total_pages FROM page_counts)
       SELECT pc.page_id, pc.url, pc.occurrences, t.total_pages
       FROM page_counts pc
       CROSS JOIN total t
       ORDER BY ${orderClause}
       LIMIT $4 OFFSET $5`,
       [scan_session_id, ruleId, search, limit, offset, pageGroupScope.value, crawler_id],
    );

    const total = pagesRes.rows[0]?.total_pages ?? 0;
    res.json({
      rule: ruleRes.rows[0],
      sampleElements: samplesRes.rows,
      pages: pagesRes.rows,
      total: +total,
      page,
      limit,
      scanId: scan_session_id,
    });
  } finally {
    client.release();
  }
});

// GET /api/sites/:id/compliance
// Aggregates every distinct rule from the latest completed scan and groups
// occurrences/pages by WCAG success criterion number (e.g. "1.4.3"). A rule
// mapped to multiple SCs (comma-joined in wcag_criteria) contributes to each.
// Rules with no SC mapping (WAI-ARIA / Best Practice) are bucketed under "bp".
// Framework-specific numbering (EAA "9.x", ADA = same as WCAG) is applied
// client-side — this endpoint always returns raw WCAG SC keys.
router.get("/sites/:id/compliance", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const siteId = parseInt(req.params["id"] as string, 10);
  if (!await canViewAccessibilityDashboard(req, res, siteId)) return;

  const client = await pool.connect();
  try {
    const sessionRes = await client.query(
      `SELECT id AS crawler_id, scan_session_id FROM crawler_sessions
       WHERE site_id = $1 AND status = 'completed' AND scan_session_id IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`,
      [siteId],
    );
    if (sessionRes.rows.length === 0) {
      res.json({ criteria: {}, bestPractice: null, hasData: false });
      return;
    }
    const { scan_session_id, crawler_id } = sessionRes.rows[0];
    const pageGroupScope = await resolvePageGroupScope(client, crawler_id, req.query["page_group"]);
    if (pageGroupScope.error) { res.status(400).json({ error: pageGroupScope.error }); return; }

    const result = await client.query(
      `SELECT ai.rule_id, ai.impact,
              MAX(ai.description)   AS description,
              MAX(ai.wcag_criteria) AS wcag_criteria,
              MAX(ai.wcag_level)    AS wcag_level,
              COUNT(*)::int                    AS occurrences,
              COUNT(DISTINCT ai.page_id)::int  AS pages_affected
       FROM accessibility_issues ai
       JOIN page_results pr ON pr.id = ai.page_id
       WHERE pr.scan_id = $1
          AND ($2::text IS NULL OR EXISTS (
            SELECT 1 FROM crawler_pages cp
            WHERE cp.session_id = $3 AND cp.url = pr.url
              AND COALESCE(cp.page_type, 'General') = $2
          ))
       GROUP BY ai.rule_id, ai.impact`,
       [scan_session_id, pageGroupScope.value, crawler_id],
    );

    interface RuleAgg {
      rule_id: string;
      impact: string;
      description: string;
      wcag_level: string | null;
      occurrences: number;
      pages_affected: number;
    }

    const criteria: Record<string, { occurrences: number; pages: number; rules: RuleAgg[] }> = {};
    const bestPractice: { occurrences: number; pages: number; rules: RuleAgg[] } = {
      occurrences: 0, pages: 0, rules: [],
    };

    for (const row of result.rows) {
      const agg: RuleAgg = {
        rule_id: row.rule_id,
        impact: row.impact,
        description: row.description,
        wcag_level: row.wcag_level,
        occurrences: +row.occurrences,
        pages_affected: +row.pages_affected,
      };
      const scList: string[] = (row.wcag_criteria as string | null)
        ?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

      if (scList.length === 0) {
        bestPractice.occurrences += agg.occurrences;
        bestPractice.pages += agg.pages_affected;
        bestPractice.rules.push(agg);
        continue;
      }
      for (const sc of scList) {
        if (!criteria[sc]) criteria[sc] = { occurrences: 0, pages: 0, rules: [] };
        criteria[sc].occurrences += agg.occurrences;
        criteria[sc].pages += agg.pages_affected;
        criteria[sc].rules.push(agg);
      }
    }

    res.json({ criteria, bestPractice, hasData: true });
  } finally {
    client.release();
  }
});

export default router;

