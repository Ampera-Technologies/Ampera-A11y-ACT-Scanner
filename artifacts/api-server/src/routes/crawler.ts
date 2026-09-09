import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { db, pool } from "@workspace/db";
import {
  crawlerSessionsTable,
  crawlerPagesTable,
  brokenLinksTable,
  sitesTable,
  siteContentRulesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, sql, asc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/authMiddleware";
import { getRulesForLevels, ALL_SCAN_LEVELS } from "../lib/scanner";
import { canAccessSite, getEffectivePermissions } from "../lib/permissions";
import { logger } from "../lib/logger";
import {
  startCrawlerJob,
  pauseCrawlerJob,
  cancelCrawlerJob,
  resumeCrawlerJob,
  startScanPhase,
  retryFailedPages,
  isCrawlerActive,
  classifyPageType,
  getDiscoveryCache,
  clearDiscoveryCache,
  type CrawlerConfig,
} from "../lib/crawler";
import { parseUrlsFromCsv } from "../lib/sitemap";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const crawlerSessionColumns = {
  id: crawlerSessionsTable.id, userId: crawlerSessionsTable.userId, siteId: crawlerSessionsTable.siteId, name: crawlerSessionsTable.name,
  seedUrl: crawlerSessionsTable.seedUrl, status: crawlerSessionsTable.status, lifecycleStatus: crawlerSessionsTable.lifecycleStatus,
  config: crawlerSessionsTable.config, scanSessionId: crawlerSessionsTable.scanSessionId, scheduledStartAt: crawlerSessionsTable.scheduledStartAt,
  totalDiscovered: crawlerSessionsTable.totalDiscovered, totalScanned: crawlerSessionsTable.totalScanned, totalFailed: crawlerSessionsTable.totalFailed,
  totalSkipped: crawlerSessionsTable.totalSkipped, totalIssues: crawlerSessionsTable.totalIssues, totalRules: crawlerSessionsTable.totalRules,
  brokenLinksCount: crawlerSessionsTable.brokenLinksCount, createdAt: crawlerSessionsTable.createdAt, startedAt: crawlerSessionsTable.startedAt,
  discoveredAt: crawlerSessionsTable.discoveredAt, scanStartedAt: crawlerSessionsTable.scanStartedAt, completedAt: crawlerSessionsTable.completedAt,
  pausedAt: crawlerSessionsTable.pausedAt, errorMessage: crawlerSessionsTable.errorMessage,
};
const siteColumns = {
  id: sitesTable.id, userId: sitesTable.userId, name: sitesTable.name, baseUrl: sitesTable.baseUrl, description: sitesTable.description,
  defaultScope: sitesTable.defaultScope, sitemapUrl: sitesTable.sitemapUrl, crawlType: sitesTable.crawlType, maxPages: sitesTable.maxPages,
  maxDepth: sitesTable.maxDepth, respectRobotsTxt: sitesTable.respectRobotsTxt, assetMode: sitesTable.assetMode,
  scheduleEnabled: sitesTable.scheduleEnabled, scheduleIntervalDays: sitesTable.scheduleIntervalDays, timezone: sitesTable.timezone,
  nextCrawlAt: sitesTable.nextCrawlAt, lastCompletedAt: sitesTable.lastCompletedAt, lifecycleStatus: sitesTable.lifecycleStatus,
  targetScore: sitesTable.targetScore, createdAt: sitesTable.createdAt, updatedAt: sitesTable.updatedAt,
};
const getSiteContentRuleColumns = () => ({
  id: siteContentRulesTable.id, siteId: siteContentRulesTable.siteId, ruleType: siteContentRulesTable.ruleType,
  pattern: siteContentRulesTable.pattern, patternType: siteContentRulesTable.patternType, note: siteContentRulesTable.note,
  enabled: siteContentRulesTable.enabled, createdBy: siteContentRulesTable.createdBy, createdAt: siteContentRulesTable.createdAt, updatedAt: siteContentRulesTable.updatedAt,
});
const crawlerPageColumns = {
  id: crawlerPagesTable.id, sessionId: crawlerPagesTable.sessionId, url: crawlerPagesTable.url, urlHash: crawlerPagesTable.urlHash,
  status: crawlerPagesTable.status, depth: crawlerPagesTable.depth, discoveredFrom: crawlerPagesTable.discoveredFrom,
  contentHash: crawlerPagesTable.contentHash, httpStatus: crawlerPagesTable.httpStatus, issueCount: crawlerPagesTable.issueCount,
  ruleCount: crawlerPagesTable.ruleCount, pageType: crawlerPagesTable.pageType, errorMessage: crawlerPagesTable.errorMessage,
  scannedAt: crawlerPagesTable.scannedAt, capturedHtml: crawlerPagesTable.capturedHtml,
};
const brokenLinkColumns = {
  id: brokenLinksTable.id, sessionId: brokenLinksTable.sessionId, sourceUrl: brokenLinksTable.sourceUrl, brokenUrl: brokenLinksTable.brokenUrl,
  httpStatus: brokenLinksTable.httpStatus, errorType: brokenLinksTable.errorType, anchorText: brokenLinksTable.anchorText, checkedAt: brokenLinksTable.checkedAt,
};

const DEFAULT_CRAWLER_PERMISSIONS = {
  canCreateCrawl: true,
  canDeleteCrawl: true,
  canViewCrawlHistory: true,
};

type TriggeredBy = {
  id: number;
  fullName: string;
  username: string;
  role: string;
};

async function getTriggeredByUsers(userIds: Array<string | null | undefined>) {
  const ids = Array.from(
    new Set(
      userIds
        .map((userId) => Number(userId))
        .filter((userId) => Number.isInteger(userId) && userId > 0),
    ),
  );
  if (ids.length === 0) return new Map<number, TriggeredBy>();

  let users: TriggeredBy[] = [];
  try {
    const result = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        username: usersTable.username,
        role: usersTable.role,
      })
      .from(usersTable)
      .where(inArray(usersTable.id, ids));
    users = Array.isArray(result) ? result : [];
  } catch {
    // Creator details are supplementary; a missing/deleted user must not
    // prevent a crawl history or detail response from loading.
    users = [];
  }

  return new Map(users.map((user) => [user.id, user]));
}

function withTriggeredBy<T extends { userId: string | null }>(
  session: T,
  users: Map<number, TriggeredBy>,
) {
  const userId = Number(session.userId);
  const triggeredBy =
    users.get(userId) ??
    (session.userId
      ? {
          id: userId,
          fullName: `User #${session.userId}`,
          username: "",
          role: "",
        }
      : null);
  return { ...session, triggeredBy };
}

async function getCrawlerPermissions(req: any) {
  const userId = parseInt(getAuthUserId(req), 10);
  const role = req.session?.user?.role ?? "user";
  const permissions = await getEffectivePermissions(userId, role);
  return {
    ...DEFAULT_CRAWLER_PERMISSIONS,
    ...(permissions ?? {}),
  };
}

function getAuthUserId(req: any): string {
  return req.session?.user?.id?.toString() ?? "";
}
function isAdminUser(req: any): boolean {
  const role = req.session?.user?.role;
  return role === "super_admin" || role === "admin";
}

/**
 * Loads a crawler session and verifies that the requesting user may access it.
 *
 * Access is granted when ANY of the following is true:
 *  1. The user is an admin / super_admin.
 *  2. The session has a siteId and canAccessSite returns a non-null level.
 *  3. The session has no siteId and the user created the session (userId match).
 *
 * Returns the session record on success, or writes the appropriate 403/404
 * response and returns null.
 */
async function resolveSession(req: any, res: Response, sessionId: number) {
  const userId = getAuthUserId(req);
  const adminUser = isAdminUser(req);
  const perms = await getCrawlerPermissions(req);
  if (!perms.canViewCrawlHistory) {
    res.status(403).json({ error: "Crawler history access is disabled" });
    return null;
  }

  const [session] = await db.select(crawlerSessionColumns).from(crawlerSessionsTable)
    .where(eq(crawlerSessionsTable.id, sessionId)).limit(1);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return null;
  }

  if (adminUser) return session;

  const siteId = session.siteId ?? (session.config as any)?.siteId;
  if (siteId) {
    const userIdNum = parseInt(userId, 10);
    const userRole = req.session?.user?.role ?? "user";
    const access = await canAccessSite(userIdNum, userId, userRole, siteId);
    if (!access) {
      res.status(403).json({ error: "Forbidden" });
      return null;
    }
    // For "user" role accounts, site membership alone is not enough —
    // they may only access sessions they personally started, unless they
    // hold the canViewAllScans permission.
    if (userRole === "user") {
      if (!perms.canViewAllScans && session.userId !== userId) {
        res.status(403).json({ error: "Forbidden" });
        return null;
      }
    }
    return session;
  }

  // No siteId — fall back to creator ownership
  if (session.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return session;
}

function validateCreateCrawler(body: any): { data: any; error?: string } {
  if (!body.seedUrl || typeof body.seedUrl !== "string") {
    return { data: null, error: "seedUrl is required" };
  }
  try { new URL(body.seedUrl); } catch { return { data: null, error: "seedUrl must be a valid URL" }; }
  let scheduledStartAt: Date | undefined;
  if (body.scheduledStartAt != null && body.scheduledStartAt !== "") {
    const parsed = new Date(body.scheduledStartAt);
    if (Number.isNaN(parsed.getTime())) {
      return { data: null, error: "scheduledStartAt must be a valid date and time" };
    }
    if (parsed.getTime() <= Date.now()) {
      return { data: null, error: "scheduledStartAt must be in the future" };
    }
    scheduledStartAt = parsed;
  }
  let proxyPacUrl: string | undefined;
  if (body.proxyPacUrl != null && body.proxyPacUrl !== "") {
    if (typeof body.proxyPacUrl !== "string" || body.proxyPacUrl.length > 2048) {
      return { data: null, error: "proxyPacUrl must be a valid proxy or PAC URL" };
    }
    try {
      const parsed = new URL(body.proxyPacUrl.trim());
      if (!["http:", "https:", "socks4:", "socks5:"].includes(parsed.protocol)) {
        return { data: null, error: "proxyPacUrl must use HTTP(S), SOCKS4, or SOCKS5" };
      }
      proxyPacUrl = parsed.toString();
    } catch {
      return { data: null, error: "proxyPacUrl must be a valid proxy or PAC URL" };
    }
  }
  let localePatterns: string[] | undefined;
  if (body.localePatterns != null) {
    if (!Array.isArray(body.localePatterns) || body.localePatterns.length > 20) {
      return { data: null, error: "localePatterns must contain no more than 20 path filters" };
    }
    if (body.localePatterns.some((pattern: unknown) => typeof pattern !== "string" || pattern.trim().length > 500)) {
      return { data: null, error: "Each path filter must be a string of 500 characters or fewer" };
    }
    const normalized = Array.from(
      new Set(body.localePatterns.map((pattern: string) => pattern.trim()).filter(Boolean)),
    );
    localePatterns = normalized.length > 0 ? normalized : undefined;
  }
  return {
    data: {
      seedUrl: body.seedUrl.trim(),
      seedUrls: Array.isArray(body.seedUrls) ? body.seedUrls : [],
      sitemapUrl: typeof body.sitemapUrl === "string" ? body.sitemapUrl : undefined,
      // Manual crawler sessions use the value entered in the form. Managed
      // site defaults are reserved for scheduled and "Run now" crawls.
      maxPages: typeof body.maxPages === "number" ? Math.max(1, Math.floor(body.maxPages)) : 2000,
      maxDepth: typeof body.maxDepth === "number" ? Math.min(20, Math.max(0, body.maxDepth)) : 5,
      respectRobotsTxt: body.respectRobotsTxt !== false,
      useSitemap: body.useSitemap !== false,
      followLinks: body.followLinks !== false,
      stayOnDomain: body.stayOnDomain !== false,
      crawlScope: ["all-subdomains","subdomain","subfolder","exact-url"].includes(body.crawlScope)
        ? body.crawlScope : undefined,
      blockAssets: body.blockAssets !== false,
      tabPoolSize: typeof body.tabPoolSize === "number" ? Math.min(5, Math.max(1, body.tabPoolSize)) : 1,
      scanDelayMs: typeof body.scanDelayMs === "number" ? Math.min(100000, Math.max(0, body.scanDelayMs)) : 10000,
      discoveryWorkers: typeof body.discoveryWorkers === "number" ? Math.min(4, Math.max(1, Math.floor(body.discoveryWorkers))) : 2,
      proxyPacUrl,
      authenticated: body.authenticated === true,
      authUrl: body.authUrl,
      authUsernameSelector: body.authUsernameSelector,
      authPasswordSelector: body.authPasswordSelector,
      authUsername: body.authUsername,
      authPassword: body.authPassword,
      authSubmitSelector: body.authSubmitSelector,
      incremental: body.incremental === true,
      prevSessionId: typeof body.prevSessionId === "number" ? body.prevSessionId : undefined,
      detectBrokenLinks: body.detectBrokenLinks !== false,
      autoScan: body.autoScan === true,
       crawlOnly: body.crawlOnly === true,
      skipDiscovery: body.skipDiscovery === true,
      siteId: typeof body.siteId === "number" ? body.siteId : undefined,
      groupId: typeof body.groupId === "number" ? body.groupId : undefined,
      localePattern: typeof body.localePattern === "string" && body.localePattern.trim() ? body.localePattern.trim() : undefined,
      localePatterns,
      timezone: typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : undefined,
      initiatorName: body.initiatorName,
      initiatorRole: body.initiatorRole,
      wcagLevels: Array.isArray(body.wcagLevels)
        ? body.wcagLevels.filter((level: unknown): level is string => typeof level === "string" && level.trim().length > 0)
        : undefined,
      selectedRules: Array.isArray(body.rules)
        ? body.rules.filter((rule: unknown): rule is string => typeof rule === "string" && rule.trim().length > 0)
        : undefined,
      rules: (() => {
        const rawLevels = Array.isArray(body.wcagLevels) ? (body.wcagLevels as string[]) : [];
        const isAll = rawLevels.length === 0 || ALL_SCAN_LEVELS.every((l) => rawLevels.includes(l));
        const baseRules: string[] = Array.isArray(body.rules) ? body.rules : [];
        if (isAll) return baseRules.length ? baseRules : undefined;
        const merged = [...new Set([...getRulesForLevels(rawLevels), ...baseRules])];
        return merged.length ? merged : undefined;
      })(),
      crawlBoost: body.crawlBoost === true,
      scheduledStartAt,
    },
  };
}

// POST /api/crawler/sessions — create a new crawler session
router.post("/crawler/sessions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getAuthUserId(req);
  const adminUser = isAdminUser(req);
  const perms = await getCrawlerPermissions(req);
  if (!perms.canCreateCrawl) {
    res.status(403).json({ error: "Crawl creation is disabled" });
    return;
  }
  const validated = validateCreateCrawler(req.body);
  if (validated.error) { res.status(400).json({ error: validated.error }); return; }

  const data = validated.data;

  // Validate siteId: verify existence, then enforce access for non-admins
  let siteName: string | undefined;
  let sitePolicy: typeof sitesTable.$inferSelect | undefined;
  if (data.siteId != null) {
    const [siteRow] = await db
      .select(siteColumns)
      .from(sitesTable)
      .where(eq(sitesTable.id, data.siteId))
      .limit(1);
    if (!siteRow) {
      res.status(400).json({ error: "The specified site does not exist" });
      return;
    }
    sitePolicy = siteRow;
    siteName = siteRow.name;

    if (!adminUser) {
      const userIdNum = parseInt(userId, 10);
      const userRole = (req as any).session?.user?.role ?? "user";
      const siteAccess = await canAccessSite(userIdNum, userId, userRole, data.siteId);
      if (!siteAccess) {
        res.status(403).json({ error: "You do not have access to the specified site" });
        return;
      }
    }
  } else {
    res.status(403).json({ error: "A crawl must be associated with an accessible site" });
    return;
  }

  // Auto-generate name: site name or hostname + date
  let sessionName: string;
  try {
    const hostname = new URL(data.seedUrl).hostname;
    sessionName = siteName
      ? `${siteName} — ${new Date().toISOString().slice(0, 10)}`
      : `${hostname} — ${new Date().toISOString().slice(0, 10)}`;
  } catch {
    sessionName = `Crawl — ${new Date().toISOString().slice(0, 10)}`;
  }

  const config: CrawlerConfig = {
    seedUrls: [data.seedUrl, ...(data.seedUrls ?? [])].filter((u: string, i: number, a: string[]) => a.indexOf(u) === i),
    sitemapUrl: sitePolicy?.sitemapUrl ?? data.sitemapUrl,
    // Do not silently replace the manual crawler form's page limit with the
    // managed site's default. The site policy still supplies defaults for
    // scheduled/run-now sessions, while this endpoint honors the explicit
    // value the user submitted.
    maxPages: data.maxPages,
    maxDepth: sitePolicy?.maxDepth ?? data.maxDepth,
    respectRobotsTxt: sitePolicy?.respectRobotsTxt ?? data.respectRobotsTxt,
    useSitemap: sitePolicy ? Boolean(sitePolicy.sitemapUrl) || data.useSitemap : data.useSitemap,
    followLinks: data.followLinks,
    stayOnDomain: data.stayOnDomain,
    crawlScope: (sitePolicy?.defaultScope as CrawlerConfig["crawlScope"]) ?? data.crawlScope,
    blockAssets: sitePolicy ? sitePolicy.assetMode === "none" : data.blockAssets,
    tabPoolSize: data.tabPoolSize,
    scanDelayMs: data.scanDelayMs,
    discoveryWorkers: data.discoveryWorkers,
    proxyPacUrl: data.proxyPacUrl,
    authenticated: data.authenticated,
    authUrl: data.authUrl,
    authUsernameSelector: data.authUsernameSelector,
    authPasswordSelector: data.authPasswordSelector,
    authUsername: data.authUsername,
    authPassword: data.authPassword,
    authSubmitSelector: data.authSubmitSelector,
    incremental: data.incremental,
    prevSessionId: data.prevSessionId,
    detectBrokenLinks: data.detectBrokenLinks,
     autoScan: data.crawlOnly ? false : data.autoScan,
     crawlOnly: data.crawlOnly,
    skipDiscovery: data.skipDiscovery,
    crawlBoost: data.crawlBoost,
    siteId: data.siteId,
    groupId: data.groupId,
    localePattern: data.localePattern,
    localePatterns: data.localePatterns,
    timezone: sitePolicy?.timezone ?? data.timezone,
    initiatorName: data.initiatorName,
    initiatorRole: data.initiatorRole,
    wcagLevels: data.wcagLevels,
    selectedRules: data.selectedRules,
    assetMode: sitePolicy?.assetMode,
    contentRules: sitePolicy
      ? await db.select(getSiteContentRuleColumns()).from(siteContentRulesTable)
        .where(and(eq(siteContentRulesTable.siteId, sitePolicy.id), eq(siteContentRulesTable.enabled, true)))
        .orderBy(siteContentRulesTable.id)
      : undefined,
    rules: data.rules,
  };

  const [session] = await db.insert(crawlerSessionsTable).values({
    userId,
    siteId: data.siteId ?? null,
    name: sessionName,
    seedUrl: data.seedUrl,
    status: "pending",
    scheduledStartAt: data.scheduledStartAt ?? null,
    config,
  }).returning();

  // Scheduled sessions remain queued until the scheduler claims them.
  if (!data.scheduledStartAt) {
    void startCrawlerJob(session.id).catch((err) =>
      logger.error({ sessionId: session.id, err }, "Crawler job failed to start"),
    );
  }

  const triggeredByUsers = await getTriggeredByUsers([session.userId]);
  res.status(201).json(withTriggeredBy(session, triggeredByUsers));
});

// GET /api/crawler/sessions — list sessions (supports ?siteId=&status=&limit=)
router.get("/crawler/sessions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = getAuthUserId(req);
  const adminUser = isAdminUser(req);
  const perms = await getCrawlerPermissions(req);
  if (!perms.canViewCrawlHistory) {
    res.status(403).json({ error: "Crawler history access is disabled" });
    return;
  }
  const page = Math.max(1, parseInt(req.query["page"] as string || "1", 10));
  const limit = Math.min(100, parseInt(req.query["limit"] as string || "20", 10));
  const offset = (page - 1) * limit;
  const siteId = req.query["siteId"] ? parseInt(req.query["siteId"] as string, 10) : null;
  const statusFilter = req.query["status"] as string | undefined;

  // For non-admin users, verify they have access to the requested site
  if (siteId && !adminUser) {
    const userIdNum = parseInt(userId, 10);
    const userRole = (req as any).session?.user?.role ?? "user";
    const siteAccess = await canAccessSite(userIdNum, userId, userRole, siteId);
    if (!siteAccess) {
      res.status(403).json({ error: "You do not have access to the specified site" });
      return;
    }
  }

  const buildWhere = (includeUser: boolean) => {
    const conditions = [];
    if (includeUser) conditions.push(eq(crawlerSessionsTable.userId, userId));
    if (siteId) conditions.push(sql`(config->>'siteId')::int = ${siteId}`);
    if (statusFilter) conditions.push(eq(crawlerSessionsTable.status, statusFilter));
    return conditions.length === 0 ? undefined : and(...conditions as [any, ...any[]]);
  };

  const where = buildWhere(!adminUser);
  const sessions = await db.select({
    id: crawlerSessionsTable.id,
    userId: crawlerSessionsTable.userId,
    siteId: crawlerSessionsTable.siteId,
    name: crawlerSessionsTable.name,
    seedUrl: crawlerSessionsTable.seedUrl,
    status: crawlerSessionsTable.status,
    lifecycleStatus: crawlerSessionsTable.lifecycleStatus,
    config: crawlerSessionsTable.config,
    scanSessionId: crawlerSessionsTable.scanSessionId,
    scheduledStartAt: crawlerSessionsTable.scheduledStartAt,
    totalDiscovered: crawlerSessionsTable.totalDiscovered,
    totalScanned: crawlerSessionsTable.totalScanned,
    totalFailed: crawlerSessionsTable.totalFailed,
    totalSkipped: crawlerSessionsTable.totalSkipped,
    totalIssues: crawlerSessionsTable.totalIssues,
    totalRules: crawlerSessionsTable.totalRules,
    brokenLinksCount: crawlerSessionsTable.brokenLinksCount,
    createdAt: crawlerSessionsTable.createdAt,
    startedAt: crawlerSessionsTable.startedAt,
    discoveredAt: crawlerSessionsTable.discoveredAt,
    scanStartedAt: crawlerSessionsTable.scanStartedAt,
    completedAt: crawlerSessionsTable.completedAt,
    pausedAt: crawlerSessionsTable.pausedAt,
    errorMessage: crawlerSessionsTable.errorMessage,
  }).from(crawlerSessionsTable)
    .where(where)
    .orderBy(desc(crawlerSessionsTable.createdAt))
    .limit(limit).offset(offset);
  const triggeredByUsers = await getTriggeredByUsers(sessions.map((session) => session.userId));

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(crawlerSessionsTable).where(where);

  res.json({
    sessions: sessions.map((session) => withTriggeredBy(session, triggeredByUsers)),
    total,
    page,
    limit,
  });
});

// GET /api/crawler/sessions/:id — get session details
router.get("/crawler/sessions/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  const session = await resolveSession(req, res, sessionId);
  if (!session) return;

  const safeConfig = { ...(session.config as any) };
  delete safeConfig.authPassword;
  const triggeredByUsers = await getTriggeredByUsers([session.userId]);

  let pagesWithIssues = 0;
  let confirmedBrokenLinks = 0;
  if (session.scanSessionId) {
    const result = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM page_results WHERE scan_id = $1 AND status = 'completed' AND issue_count > 0`,
      [session.scanSessionId],
    );
    pagesWithIssues = parseInt(result.rows[0]?.cnt || "0", 10);
  }

  try {
    const brokenResult = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM broken_links WHERE session_id = $1 AND ((http_status >= 400 AND http_status <> 403) OR http_status IS NULL)`,
      [sessionId],
    );
    confirmedBrokenLinks = parseInt(
      brokenResult.rows[0]?.cnt || String(session.brokenLinksCount ?? 0),
      10,
    );
  } catch {
    // Keep the session detail endpoint usable if the count query is
    // unavailable; the persisted counter is the safe fallback.
    confirmedBrokenLinks = session.brokenLinksCount ?? 0;
  }

  // Count pages still waiting to be crawled in Phase 1.
  // Included here (not just in the SSE stream) so the frontend has accurate
  // queue depth even after SSE closes for paused / failed / cancelled sessions.
  // Uses pool.query (raw SQL) to avoid adding an extra Drizzle chain that the
  // test mock does not expect, while staying consistent with the other count queries above.
  let pendingPages = 0;
  try {
    const pendingResult = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM crawler_pages WHERE session_id = $1 AND status = 'pending'`,
      [sessionId],
    );
    pendingPages = parseInt(pendingResult.rows[0]?.cnt || "0", 10);
  } catch {
    // Non-critical: default to 0 if the count query is unavailable.
  }

  res.json({
    ...withTriggeredBy(session, triggeredByUsers),
    brokenLinksCount: confirmedBrokenLinks,
    config: safeConfig,
    pagesWithIssues,
    pendingPages,
    crawlBoost: !!(session.config as any)?.crawlBoost,
  });
});

// POST /api/crawler/sessions/:id/pause
router.post("/crawler/sessions/:id/pause", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  const session = await resolveSession(req, res, sessionId);
  if (!session) return;
  await pauseCrawlerJob(sessionId);
  res.json({ ok: true });
});

// POST /api/crawler/sessions/:id/resume
router.post("/crawler/sessions/:id/resume", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  const session = await resolveSession(req, res, sessionId);
  if (!session) return;
  try {
    await resumeCrawlerJob(sessionId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ sessionId, err }, "Crawler resume failed");
    res.status(500).json({ error: "Crawler resume failed" });
  }
});

// POST /api/crawler/sessions/:id/start-scan — trigger Phase 2 from "crawled" state
router.post("/crawler/sessions/:id/start-scan", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  const session = await resolveSession(req, res, sessionId);
  if (!session) return;
  void startScanPhase(sessionId).catch((err) =>
    logger.error({ sessionId, err }, "Start scan phase failed"),
  );
  res.json({ ok: true });
});

// POST /api/crawler/sessions/:id/retry-failed — reset failed pages and resume scanning
router.post("/crawler/sessions/:id/retry-failed", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  const session = await resolveSession(req, res, sessionId);
  if (!session) return;
  const result = await retryFailedPages(sessionId);
  res.json(result);
});

// POST /api/crawler/sessions/:id/cancel
router.post("/crawler/sessions/:id/cancel", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  const session = await resolveSession(req, res, sessionId);
  if (!session) return;
  await cancelCrawlerJob(sessionId);
  res.json({ ok: true });
});

// DELETE /api/crawler/sessions/:id
router.delete("/crawler/sessions/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  const session = await resolveSession(req, res, sessionId);
  if (!session) return;
  const perms = await getCrawlerPermissions(req);
  if (!perms.canDeleteCrawl) {
    res.status(403).json({ error: "Crawl deletion is disabled" });
    return;
  }
  if (!isAdminUser(req) && !(session.siteId ?? (session.config as any)?.siteId)) {
    res.status(403).json({ error: "Only crawls for accessible sites can be deleted" });
    return;
  }

  if (isCrawlerActive(sessionId)) await cancelCrawlerJob(sessionId);
  await db.delete(crawlerSessionsTable).where(eq(crawlerSessionsTable.id, sessionId));
  res.json({ ok: true });
});

// GET /api/crawler/sessions/:id/pages — paginated page list
router.get("/crawler/sessions/:id/pages", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  const _session = await resolveSession(req, res, sessionId);
  if (!_session) return;
  const page = Math.max(1, parseInt(req.query["page"] as string || "1", 10));
  const limit = Math.min(100, parseInt(req.query["limit"] as string || "50", 10));
  const offset = (page - 1) * limit;
  const statusFilter = req.query["status"] as string | undefined;
  const localeFilter = req.query["locale"] as string | undefined;
  const pageTypeFilter = req.query["pageType"] as string | undefined;
  const extensionFilter = String(req.query["extension"] ?? "").trim().toLowerCase().replace(/^\./, "");

  const conditions: any[] = [eq(crawlerPagesTable.sessionId, sessionId)];
  if (statusFilter) conditions.push(eq(crawlerPagesTable.status, statusFilter));
  if (localeFilter) conditions.push(sql`${crawlerPagesTable.url} ILIKE ${"%" + localeFilter + "%"}`);
  if (pageTypeFilter) conditions.push(eq(crawlerPagesTable.pageType, pageTypeFilter));
  if (extensionFilter) {
    conditions.push(sql`lower(split_part(split_part(${crawlerPagesTable.url}, '?', 1), '#', 1)) LIKE ${"%" + extensionFilter}`);
  }
  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions as [any, any, ...any[]]);

  const [pages, [{ total }]] = await Promise.all([
    db.select(crawlerPageColumns).from(crawlerPagesTable).where(whereClause)
      .orderBy(asc(crawlerPagesTable.id)).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(crawlerPagesTable).where(whereClause),
  ]);

  res.json({ pages, total, page, limit });
});

// GET /api/crawler/sessions/:id/pages/export — export the filtered page inventory
router.get("/crawler/sessions/:id/pages/export", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  const _session = await resolveSession(req, res, sessionId);
  if (!_session) return;
  const perms = await getCrawlerPermissions(req);
  if (!perms.canExport) {
    res.status(403).json({ error: "Report export is disabled" });
    return;
  }

  const statusFilter = req.query["status"] as string | undefined;
  const localeFilter = req.query["locale"] as string | undefined;
  const pageTypeFilter = req.query["pageType"] as string | undefined;
  const extensionFilter = String(req.query["extension"] ?? "").trim().toLowerCase().replace(/^\./, "");
  const conditions: any[] = [eq(crawlerPagesTable.sessionId, sessionId)];
  if (statusFilter) conditions.push(eq(crawlerPagesTable.status, statusFilter));
  if (localeFilter) conditions.push(sql`${crawlerPagesTable.url} ILIKE ${"%" + localeFilter + "%"}`);
  if (pageTypeFilter) conditions.push(eq(crawlerPagesTable.pageType, pageTypeFilter));
  if (extensionFilter) {
    conditions.push(sql`lower(split_part(split_part(${crawlerPagesTable.url}, '?', 1), '#', 1)) LIKE ${"%" + extensionFilter}`);
  }
  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions as [any, any, ...any[]]);
  const rows = await db.select({
    url: crawlerPagesTable.url,
    status: crawlerPagesTable.status,
    pageType: crawlerPagesTable.pageType,
    depth: crawlerPagesTable.depth,
    httpStatus: crawlerPagesTable.httpStatus,
    issueCount: crawlerPagesTable.issueCount,
    ruleCount: crawlerPagesTable.ruleCount,
    errorMessage: crawlerPagesTable.errorMessage,
    scannedAt: crawlerPagesTable.scannedAt,
  }).from(crawlerPagesTable).where(whereClause).orderBy(asc(crawlerPagesTable.id));

  const csvCell = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const header = ["URL", "Status", "Page Type", "Depth", "HTTP Status", "Issues", "Rules", "Error", "Scanned At"];
  const body = rows.map((row) => [
    row.url,
    row.status,
    row.pageType,
    row.depth,
    row.httpStatus,
    row.issueCount,
    row.ruleCount,
    row.errorMessage,
    row.scannedAt,
  ].map(csvCell).join(","));
  const csv = [header.map(csvCell).join(","), ...body].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="crawler-${sessionId}-pages.csv"`);
  res.send(`\uFEFF${csv}\r\n`);
});

// GET /api/crawler/sessions/:id/page-types — page type breakdown
router.get("/crawler/sessions/:id/page-types", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  const _session = await resolveSession(req, res, sessionId);
  if (!_session) return;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT COALESCE(page_type, 'General') as page_type, count(*)::int as count
       FROM crawler_pages
       WHERE session_id = $1
       GROUP BY page_type
       ORDER BY count DESC`,
      [sessionId],
    );
    res.json(result.rows);
  } finally {
    client.release();
  }
});

// GET /api/crawler/sessions/:id/broken-links — broken links
router.get("/crawler/sessions/:id/broken-links", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  const _session = await resolveSession(req, res, sessionId);
  if (!_session) return;
  const page = Math.max(1, parseInt(req.query["page"] as string || "1", 10));
  const limit = Math.min(100, parseInt(req.query["limit"] as string || "50", 10));
  const offset = (page - 1) * limit;

  const [links, [{ total }]] = await Promise.all([
    db.select(brokenLinkColumns).from(brokenLinksTable)
      .where(and(
        eq(brokenLinksTable.sessionId, sessionId),
        sql`((${brokenLinksTable.httpStatus} >= 400 AND ${brokenLinksTable.httpStatus} <> 403) OR ${brokenLinksTable.httpStatus} IS NULL)`,
      ))
      .orderBy(asc(brokenLinksTable.id)).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(brokenLinksTable)
      .where(and(
        eq(brokenLinksTable.sessionId, sessionId),
        sql`((${brokenLinksTable.httpStatus} >= 400 AND ${brokenLinksTable.httpStatus} <> 403) OR ${brokenLinksTable.httpStatus} IS NULL)`,
      )),
  ]);

  res.json({ links, total, page, limit });
});

// POST /api/crawler/sessions/:id/import-urls — bulk CSV upload
router.post("/crawler/sessions/:id/import-urls", requireAuth, upload.single("file"), async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  const _session = await resolveSession(req, res, sessionId);
  if (!_session) return;
  const file = (req as any).file;
  if (!file) { res.status(400).json({ error: "No file provided" }); return; }

  const content = file.buffer.toString("utf-8");
  const urls = parseUrlsFromCsv(content);
  if (urls.length === 0) { res.status(400).json({ error: "No valid URLs found in file" }); return; }

  const { normalizeUrl, computeUrlHash } = await import("../lib/crawler");
  const client = await pool.connect();
  let added = 0;
  try {
    for (const url of urls) {
      const norm = normalizeUrl(url);
      if (!norm) continue;
      const hash = computeUrlHash(norm);
      const result = await client.query(
        `INSERT INTO crawler_pages (session_id, url, url_hash, status, depth, discovered_from, page_type)
         VALUES ($1, $2, $3, 'pending', 0, 'csv-import', $4)
         ON CONFLICT (session_id, url_hash) DO NOTHING`,
        [sessionId, norm, hash, classifyPageType(norm)],
      );
      if ((result.rowCount ?? 0) > 0) added++;
    }
  } finally {
    client.release();
  }

  await db.update(crawlerSessionsTable)
    .set({ totalDiscovered: sql`total_discovered + ${added}` })
    .where(eq(crawlerSessionsTable.id, sessionId));

  res.json({ added, total: urls.length });
});

// GET /api/crawler/sessions/:id/progress — SSE stream
router.get("/crawler/sessions/:id/progress", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);

  // Verify access before opening the stream
  const _session = await resolveSession(req, res, sessionId);
  if (!_session) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Disable response buffering in nginx / Azure Application Gateway so each event
  // is forwarded to the browser immediately rather than held until the buffer fills.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const flush = () => {
    if ("flush" in res && typeof (res as any).flush === "function") (res as any).flush();
  };
  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    flush();
  };

  // Keep-alive heartbeat: Azure LB closes idle TCP connections at ~4 minutes.
  // SSE comment lines (": …") are ignored by EventSource but keep the socket alive.
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
    flush();
  }, 25_000);

  const ACTIVE_STATUSES = ["running", "pending", "discovering", "scanning"];

  const poll = async () => {
    const [session] = await db.select(crawlerSessionColumns).from(crawlerSessionsTable)
      .where(eq(crawlerSessionsTable.id, sessionId)).limit(1);

    if (!session) { send({ error: "Session not found" }); return false; }

    const safeConfig = { ...(session.config as any) };
    delete safeConfig.authPassword;
    const triggeredByUsers = await getTriggeredByUsers([session.userId]);

    const [pending] = await db.select({ cnt: sql<number>`count(*)::int` })
      .from(crawlerPagesTable)
      .where(and(eq(crawlerPagesTable.sessionId, sessionId), eq(crawlerPagesTable.status, "pending")));

    // Pages currently in phase-1 discovery or phase-2 scan
    const [inProgress] = await db.select({ cnt: sql<number>`count(*)::int` })
      .from(crawlerPagesTable)
      .where(and(
        eq(crawlerPagesTable.sessionId, sessionId),
        sql`status IN ('discovering', 'scanning')`,
      ));

    const [discovered] = await db.select({ cnt: sql<number>`count(*)::int` })
      .from(crawlerPagesTable)
      .where(and(eq(crawlerPagesTable.sessionId, sessionId), eq(crawlerPagesTable.status, "discovered")));

    send({
      ...withTriggeredBy(session, triggeredByUsers),
      config: safeConfig,
      crawlBoost: !!(session.config as any)?.crawlBoost,
      pendingPages: pending?.cnt ?? 0,
      scanningPages: inProgress?.cnt ?? 0,
      discoveredPages: discovered?.cnt ?? 0,
    });

    // Keep stream alive during the brief "crawled" → "scanning" auto-transition
    const isAutoScanTransitioning =
      session.status === "crawled" && (session.config as any)?.autoScan === true;
    return ACTIVE_STATUSES.includes(session.status) || isAutoScanTransitioning;
  };

  const running = await poll();
  if (!running) { res.end(); return; }

  const interval = setInterval(async () => {
    try {
      const stillRunning = await poll();
      if (!stillRunning) { clearInterval(interval); clearInterval(heartbeat); res.end(); }
    } catch { clearInterval(interval); clearInterval(heartbeat); res.end(); }
  }, 2000);

  req.on("close", () => { clearInterval(interval); clearInterval(heartbeat); });
});

// GET /api/crawler/discovery-cache?domain=xxx — check if a discovery cache exists for a domain
router.get("/crawler/discovery-cache", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const domain = (req.query["domain"] as string | undefined)?.trim();
  if (!domain) { res.status(400).json({ error: "domain query param required" }); return; }
  const row = await getDiscoveryCache(domain);
  res.json(row);
});

// DELETE /api/crawler/discovery-cache/:domain — clear the cache for a domain
router.delete("/crawler/discovery-cache/:domain", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const domain = req.params["domain"] as string;
  await clearDiscoveryCache(domain);
  logger.info({ domain }, "Discovery cache cleared by user");
  res.json({ ok: true });
});

export default router;
