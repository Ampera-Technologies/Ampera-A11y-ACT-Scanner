import { Router, type IRouter } from "express";
import { db, qaPagesTable, qaLinksTable, qaImagesTable, qaWordInventoryTable, scanSessionsTable, sitesTable, crawlerSessionsTable } from "@workspace/db";
import { eq, and, sql, desc, asc, or, gt, isNotNull, isNull, ilike } from "drizzle-orm";
import { requireAuth } from "../middlewares/authMiddleware";
import { runQALinkChecker, isQACheckerRunning } from "../lib/qaLinkChecker";
import { canAccessSite, getEffectivePermissions, getEffectiveSites } from "../lib/permissions";

const router: IRouter = Router();

const qaPageFields = {
  id: qaPagesTable.id,
  scanId: qaPagesTable.scanId,
  url: qaPagesTable.url,
  title: qaPagesTable.title,
  metaDescription: qaPagesTable.metaDescription,
  h1: qaPagesTable.h1,
  httpStatus: qaPagesTable.httpStatus,
  wordCount: qaPagesTable.wordCount,
  contentHash: qaPagesTable.contentHash,
  crawlDepth: qaPagesTable.crawlDepth,
  inlinkCount: qaPagesTable.inlinkCount,
  isPdf: qaPagesTable.isPdf,
  lastModified: qaPagesTable.lastModified,
  bodyText: qaPagesTable.bodyText,
  inSitemap: qaPagesTable.inSitemap,
  scannedAt: qaPagesTable.scannedAt,
} as const;

const qaLinkFields = {
  id: qaLinksTable.id,
  scanId: qaLinksTable.scanId,
  sourceUrl: qaLinksTable.sourceUrl,
  destUrl: qaLinksTable.destUrl,
  anchorText: qaLinksTable.anchorText,
  linkType: qaLinksTable.linkType,
  isUnsafe: qaLinksTable.isUnsafe,
  httpStatus: qaLinksTable.httpStatus,
  isRedirect: qaLinksTable.isRedirect,
  redirectTo: qaLinksTable.redirectTo,
  checkedAt: qaLinksTable.checkedAt,
} as const;

function scanId(req: Parameters<typeof router.get>[1] extends (req: infer R, ...a: unknown[]) => unknown ? R : never): number {
  return parseInt((req as { params: Record<string, string> }).params["id"] as string, 10);
}

async function requireQAScanAccess(req: any, res: any, next: any): Promise<void> {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid scan id" });
    return;
  }
  const user = req.session?.user;
  const perms = await getEffectivePermissions(user?.id ?? 0, user?.role ?? "user");
  if (!perms.canViewQualityAssurance) {
    res.status(403).json({ error: "Quality assurance access is disabled" });
    return;
  }
  const [scan] = await db
    .select({ siteId: scanSessionsTable.siteId })
    .from(scanSessionsTable)
    .where(eq(scanSessionsTable.id, id))
    .limit(1);
  if (!scan) {
    res.status(404).json({ error: "Scan not found" });
    return;
  }
  const crawlerSessions = await db
    .select({ siteId: crawlerSessionsTable.siteId })
    .from(crawlerSessionsTable)
    .where(eq(crawlerSessionsTable.scanSessionId, id));
  const candidateSiteIds = new Set(
    [scan.siteId, ...crawlerSessions.map((crawler) => crawler.siteId)].filter(
      (siteId): siteId is number => typeof siteId === "number",
    ),
  );
  const hasAccess = await Promise.all(
    [...candidateSiteIds].map((siteId) =>
      canAccessSite(
        user?.id ?? 0,
        String(user?.id ?? 0),
        user?.role ?? "user",
        siteId,
      ),
    ),
  );
  if (!hasAccess.some(Boolean)) {
    res.status(403).json({ error: "You do not have access to this site's QA data" });
    return;
  }
  next();
}

async function requireQASiteAccess(req: any, res: any, next: any): Promise<void> {
  const siteId = parseInt(req.params["siteId"] as string, 10);
  if (isNaN(siteId)) {
    res.status(400).json({ error: "Invalid site id" });
    return;
  }
  const user = req.session?.user;
  const perms = await getEffectivePermissions(user?.id ?? 0, user?.role ?? "user");
  if (!perms.canViewQualityAssurance) {
    res.status(403).json({ error: "Quality assurance access is disabled" });
    return;
  }
  if (!await canAccessSite(
    user?.id ?? 0,
    String(user?.id ?? 0),
    user?.role ?? "user",
    siteId,
  )) {
    res.status(403).json({ error: "You do not have access to this site's QA data" });
    return;
  }
  next();
}

router.use("/scans/:id/qa", requireAuth, requireQAScanAccess);
router.use("/qa/sites/:siteId", requireAuth, requireQASiteAccess);
router.use("/qa/sites", requireAuth, async (req: any, res: any, next: any): Promise<void> => {
  const user = req.session?.user;
  const perms = await getEffectivePermissions(user?.id ?? 0, user?.role ?? "user");
  if (!perms.canViewQualityAssurance) {
    res.status(403).json({ error: "Quality assurance access is disabled" });
    return;
  }
  next();
});

/** GET /api/scans/:id/qa/status — is the link checker running + summary counts */
router.get("/scans/:id/qa/status", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const [row] = await db
    .select({
      totalLinks: sql<number>`COUNT(*)::int`,
      checked: sql<number>`COUNT(*) FILTER (WHERE checked_at IS NOT NULL)::int`,
       broken: sql<number>`COUNT(*) FILTER (WHERE (http_status >= 400 AND http_status <> 403) OR (http_status = 0 AND checked_at IS NOT NULL))::int`,
      redirects: sql<number>`COUNT(*) FILTER (WHERE is_redirect = true)::int`,
      unchecked: sql<number>`COUNT(*) FILTER (WHERE checked_at IS NULL)::int`,
    })
    .from(qaLinksTable)
    .where(eq(qaLinksTable.scanId, id));

  const [pagesRow] = await db
    .select({
      totalPages: sql<number>`COUNT(*)::int`,
      missingTitles: sql<number>`COUNT(*) FILTER (WHERE title IS NULL OR BTRIM(title) = '')::int`,
      invalidDescriptions: sql<number>`COUNT(*) FILTER (
        WHERE meta_description IS NULL
          OR BTRIM(meta_description) = ''
          OR LENGTH(meta_description) < 50
          OR LENGTH(meta_description) > 160
      )::int`,
      missingH1s: sql<number>`COUNT(*) FILTER (WHERE h1 IS NULL OR BTRIM(h1) = '')::int`,
      thinContent: sql<number>`COUNT(*) FILTER (WHERE word_count IS NULL OR word_count < 100)::int`,
      missingFromSitemap: sql<number>`COUNT(*) FILTER (WHERE in_sitemap = false)::int`,
      responseErrors: sql<number>`COUNT(*) FILTER (WHERE http_status IS NULL OR http_status < 200 OR http_status >= 400)::int`,
    })
    .from(qaPagesTable)
    .where(eq(qaPagesTable.scanId, id));

  res.json({
    running: isQACheckerRunning(id),
    totalPages: pagesRow?.totalPages ?? 0,
    totalLinks: row?.totalLinks ?? 0,
    checked: row?.checked ?? 0,
    broken: row?.broken ?? 0,
    redirects: row?.redirects ?? 0,
    unchecked: row?.unchecked ?? 0,
    pageChecks: {
      pageTitles: { checked: pagesRow?.totalPages ?? 0, issues: pagesRow?.missingTitles ?? 0 },
      metaDescriptions: { checked: pagesRow?.totalPages ?? 0, issues: pagesRow?.invalidDescriptions ?? 0 },
      h1Headings: { checked: pagesRow?.totalPages ?? 0, issues: pagesRow?.missingH1s ?? 0 },
      contentDepth: { checked: pagesRow?.totalPages ?? 0, issues: pagesRow?.thinContent ?? 0 },
      sitemapCoverage: { checked: pagesRow?.totalPages ?? 0, issues: pagesRow?.missingFromSitemap ?? 0 },
      responseStatus: { checked: pagesRow?.totalPages ?? 0, issues: pagesRow?.responseErrors ?? 0 },
    },
  });
});

/** POST /api/scans/:id/qa/recheck — re-run link checker */
router.post("/scans/:id/qa/recheck", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  if (isQACheckerRunning(id)) {
    res.json({ started: false, message: "Checker already running" });
    return;
  }

  // Reset checked_at so all links are re-checked
  await db
    .update(qaLinksTable)
    .set({ checkedAt: null, httpStatus: null, isRedirect: false, redirectTo: null })
    .where(eq(qaLinksTable.scanId, id));

  runQALinkChecker(id).catch(() => {});
  res.json({ started: true });
});

/** GET /api/scans/:id/qa/broken-links */
router.get("/scans/:id/qa/broken-links", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const page = Math.max(1, parseInt(req.query["page"] as string ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query["limit"] as string ?? "50", 10)));
  const offset = (page - 1) * limit;
  const search = (req.query["search"] as string ?? "").trim();
  const type = (req.query["type"] as string ?? "").trim();
  const status = (req.query["status"] as string ?? "").trim();

  const brokenConditions = [
    eq(qaLinksTable.scanId, id),
    isNotNull(qaLinksTable.checkedAt),
    or(
      and(gt(qaLinksTable.httpStatus, 399), sql`${qaLinksTable.httpStatus} <> 403`),
      and(eq(qaLinksTable.httpStatus, 0), isNotNull(qaLinksTable.checkedAt)),
    ),
  ];
  if (type) brokenConditions.push(eq(qaLinksTable.linkType, type));
  if (search) {
    brokenConditions.push(sql`(
      dest_url ILIKE ${"%" + search + "%"} OR
      source_url ILIKE ${"%" + search + "%"} OR
      anchor_text ILIKE ${"%" + search + "%"}
    )`);
  }
  if (status === "timeout") brokenConditions.push(eq(qaLinksTable.httpStatus, 0));
  else if (/^\d{3}$/.test(status)) brokenConditions.push(eq(qaLinksTable.httpStatus, parseInt(status, 10)));
  else if (status === "4xx") brokenConditions.push(sql`${qaLinksTable.httpStatus} BETWEEN 400 AND 499`);
  else if (status === "5xx") brokenConditions.push(sql`${qaLinksTable.httpStatus} BETWEEN 500 AND 599`);

  // Broken links include final 4xx/5xx responses and checked transport
  // failures represented by status 0. Successful redirects are separate.
  const rows = await db
    .select({
      destUrl: qaLinksTable.destUrl,
      httpStatus: qaLinksTable.httpStatus,
      linkType: qaLinksTable.linkType,
      checkedAt: qaLinksTable.checkedAt,
      sourceCount: sql<number>`COUNT(DISTINCT source_url)::int`,
      sources: sql<string[]>`array_agg(DISTINCT source_url)`,
      anchorTexts: sql<string[]>`array_agg(DISTINCT anchor_text) FILTER (WHERE anchor_text IS NOT NULL AND anchor_text != '')`,
    })
    .from(qaLinksTable)
      .where(and(...brokenConditions))
    .groupBy(qaLinksTable.destUrl, qaLinksTable.httpStatus, qaLinksTable.linkType, qaLinksTable.checkedAt)
    .orderBy(desc(sql`COUNT(DISTINCT source_url)`))
    .limit(limit)
    .offset(offset);

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(DISTINCT dest_url)::int` })
    .from(qaLinksTable)
      .where(and(...brokenConditions));

  res.json({ data: rows, total: countRow?.total ?? 0, page, limit });
});

/** GET /api/scans/:id/qa/redirects */
router.get("/scans/:id/qa/redirects", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const page = Math.max(1, parseInt(req.query["page"] as string ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query["limit"] as string ?? "50", 10)));
  const offset = (page - 1) * limit;
  const search = (req.query["search"] as string ?? "").trim();
  const type = (req.query["type"] as string ?? "").trim();

  const redirectConditions = [
    eq(qaLinksTable.scanId, id),
    eq(qaLinksTable.isRedirect, true),
    isNotNull(qaLinksTable.checkedAt),
  ];
  if (type) redirectConditions.push(eq(qaLinksTable.linkType, type));
  if (search) {
    redirectConditions.push(sql`(
      dest_url ILIKE ${"%" + search + "%"} OR
      redirect_to ILIKE ${"%" + search + "%"} OR
      source_url ILIKE ${"%" + search + "%"}
    )`);
  }
  const rows = await db
    .select({
      destUrl: qaLinksTable.destUrl,
      redirectTo: qaLinksTable.redirectTo,
      httpStatus: qaLinksTable.httpStatus,
      linkType: qaLinksTable.linkType,
      sourceCount: sql<number>`COUNT(DISTINCT source_url)::int`,
      sources: sql<string[]>`array_agg(DISTINCT source_url)`,
    })
    .from(qaLinksTable)
      .where(and(...redirectConditions))
    .groupBy(qaLinksTable.destUrl, qaLinksTable.redirectTo, qaLinksTable.httpStatus, qaLinksTable.linkType)
    .orderBy(desc(sql`COUNT(DISTINCT source_url)`))
    .limit(limit)
    .offset(offset);

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(DISTINCT dest_url)::int` })
    .from(qaLinksTable)
      .where(and(...redirectConditions));

  res.json({ data: rows, total: countRow?.total ?? 0, page, limit });
});

/** GET /api/scans/:id/qa/pages — page inventory */
router.get("/scans/:id/qa/pages", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const page = Math.max(1, parseInt(req.query["page"] as string ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query["limit"] as string ?? "50", 10)));
  const offset = (page - 1) * limit;
  const search = (req.query["search"] as string ?? "").trim();

  let query = db
    .select(qaPageFields)
    .from(qaPagesTable)
    .where(
      search
        ? and(
            eq(qaPagesTable.scanId, id),
            sql`(url ILIKE ${"%" + search + "%"} OR title ILIKE ${"%" + search + "%"})`,
          )
        : eq(qaPagesTable.scanId, id),
    )
    .$dynamic();

  const rows = await query.orderBy(asc(qaPagesTable.url)).limit(limit).offset(offset);

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(qaPagesTable)
    .where(
      search
        ? and(
            eq(qaPagesTable.scanId, id),
            sql`(url ILIKE ${"%" + search + "%"} OR title ILIKE ${"%" + search + "%"})`,
          )
        : eq(qaPagesTable.scanId, id),
    );

  res.json({ data: rows, total: countRow?.total ?? 0, page, limit });
});

/** GET /api/scans/:id/qa/links — full link table (for link graph) */
router.get("/scans/:id/qa/links", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const page = Math.max(1, parseInt(req.query["page"] as string ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query["limit"] as string ?? "100", 10)));
  const offset = (page - 1) * limit;
  const type = req.query["type"] as string | undefined;
  const sourceUrl = req.query["source"] as string | undefined;

  const conditions = [eq(qaLinksTable.scanId, id)];
  if (type) conditions.push(eq(qaLinksTable.linkType, type));
  if (sourceUrl) conditions.push(eq(qaLinksTable.sourceUrl, sourceUrl));

  const rows = await db
    .select(qaLinkFields)
    .from(qaLinksTable)
    .where(and(...conditions))
    .orderBy(asc(qaLinksTable.sourceUrl), asc(qaLinksTable.destUrl))
    .limit(limit)
    .offset(offset);

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(qaLinksTable)
    .where(and(...conditions));

  res.json({ data: rows, total: countRow?.total ?? 0, page, limit });
});

/** GET /api/scans/:id/qa/links-overview — aggregate link stats by category */
router.get("/scans/:id/qa/links-overview", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      internal: sql<number>`COUNT(*) FILTER (WHERE link_type = 'internal')::int`,
      external: sql<number>`COUNT(*) FILTER (WHERE link_type = 'external')::int`,
      email: sql<number>`COUNT(*) FILTER (WHERE dest_url ILIKE 'mailto:%')::int`,
      phone: sql<number>`COUNT(*) FILTER (WHERE dest_url ILIKE 'tel:%')::int`,
      document: sql<number>`COUNT(*) FILTER (WHERE dest_url ~* '\\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|csv)(\\?|#|$)')::int`,
      media: sql<number>`COUNT(*) FILTER (WHERE dest_url ~* '\\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff|mp4|webm|ogg|avi|mov|mp3|wav)(\\?|#|$)')::int`,
      javascript: sql<number>`COUNT(*) FILTER (WHERE dest_url ~* '\\.(js|mjs)(\\?|#|$)')::int`,
      css: sql<number>`COUNT(*) FILTER (WHERE dest_url ~* '\\.css(\\?|#|$)')::int`,
        broken: sql<number>`COUNT(*) FILTER (WHERE checked_at IS NOT NULL AND ((http_status >= 400 AND http_status <> 403) OR http_status = 0))::int`,
      redirects: sql<number>`COUNT(*) FILTER (WHERE is_redirect = true AND checked_at IS NOT NULL)::int`,
      uniqueUrls: sql<number>`COUNT(DISTINCT dest_url)::int`,
    })
    .from(qaLinksTable)
    .where(eq(qaLinksTable.scanId, id));

  res.json(row ?? {});
});

/** GET /api/scans/:id/qa/link-inventory — filtered link list */
router.get("/scans/:id/qa/link-inventory", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const page = Math.max(1, parseInt(req.query["page"] as string ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query["limit"] as string ?? "50", 10)));
  const offset = (page - 1) * limit;
  const category = (req.query["category"] as string ?? "all").toLowerCase();
  const search = (req.query["search"] as string ?? "").trim();
  const type = (req.query["type"] as string ?? "").trim();

  const conditions = [eq(qaLinksTable.scanId, id)];

  switch (category) {
    case "internal": conditions.push(eq(qaLinksTable.linkType, "internal")); break;
    case "external": conditions.push(eq(qaLinksTable.linkType, "external")); break;
    case "email": conditions.push(sql`dest_url ILIKE 'mailto:%'`); break;
    case "phone": conditions.push(sql`dest_url ILIKE 'tel:%'`); break;
    case "document": conditions.push(sql`dest_url ~* '\\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|csv)(\\?|#|$)'`); break;
    case "media": conditions.push(sql`dest_url ~* '\\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff|mp4|webm|ogg|avi|mov|mp3|wav)(\\?|#|$)'`); break;
    case "javascript": conditions.push(sql`dest_url ~* '\\.(js|mjs)(\\?|#|$)'`); break;
    case "css": conditions.push(sql`dest_url ~* '\\.css(\\?|#|$)'`); break;
  }
  if (type && category === "all") {
    conditions.push(eq(qaLinksTable.linkType, type));
  }

  if (search) {
    conditions.push(sql`(dest_url ILIKE ${"%" + search + "%"} OR anchor_text ILIKE ${"%" + search + "%"})`);
  }

  const rows = await db
    .select({
      destUrl: qaLinksTable.destUrl,
      sourceUrl: qaLinksTable.sourceUrl,
      anchorText: qaLinksTable.anchorText,
      linkType: qaLinksTable.linkType,
      httpStatus: qaLinksTable.httpStatus,
      isRedirect: qaLinksTable.isRedirect,
      redirectTo: qaLinksTable.redirectTo,
      checkedAt: qaLinksTable.checkedAt,
    })
    .from(qaLinksTable)
    .where(and(...conditions))
    .orderBy(asc(qaLinksTable.destUrl), asc(qaLinksTable.sourceUrl))
    .limit(limit)
    .offset(offset);

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(qaLinksTable)
    .where(and(...conditions));

  res.json({ data: rows, total: countRow?.total ?? 0, page, limit });
});

/** GET /api/scans/:id/qa/link-text — anchor text frequency */
router.get("/scans/:id/qa/link-text", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const page = Math.max(1, parseInt(req.query["page"] as string ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query["limit"] as string ?? "50", 10)));
  const offset = (page - 1) * limit;
  const search = (req.query["search"] as string ?? "").trim();
  const textCondition = sql`anchor_text IS NOT NULL AND trim(anchor_text) != ''`;
  const conditions = search
    ? and(
        eq(qaLinksTable.scanId, id),
        textCondition,
        ilike(qaLinksTable.anchorText, `%${search}%`),
      )
    : and(eq(qaLinksTable.scanId, id), textCondition);

  const rows = await db
    .select({
      anchorText: qaLinksTable.anchorText,
      count: sql<number>`COUNT(*)::int`,
      uniqueUrls: sql<number>`COUNT(DISTINCT dest_url)::int`,
      uniquePages: sql<number>`COUNT(DISTINCT source_url)::int`,
    })
    .from(qaLinksTable)
    .where(conditions)
    .groupBy(qaLinksTable.anchorText)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(limit)
    .offset(offset);

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(DISTINCT anchor_text)::int` })
    .from(qaLinksTable)
    .where(conditions);

  res.json({ data: rows, total: countRow?.total ?? 0, page, limit });
});

/** GET /api/scans/:id/qa/pages-with-broken — source pages that have broken outbound links */
router.get("/scans/:id/qa/pages-with-broken", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const page = Math.max(1, parseInt(req.query["page"] as string ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query["limit"] as string ?? "50", 10)));
  const offset = (page - 1) * limit;
  const search = (req.query["search"] as string ?? "").trim();
  const pageCondition = search
    ? and(
        eq(qaLinksTable.scanId, id),
        isNotNull(qaLinksTable.checkedAt),
        sql`source_url ILIKE ${"%" + search + "%"}`,
      )
    : and(eq(qaLinksTable.scanId, id), isNotNull(qaLinksTable.checkedAt));

  const rows = await db
    .select({
      sourceUrl: qaLinksTable.sourceUrl,
        brokenCount: sql<number>`COUNT(*) FILTER (WHERE (http_status >= 400 AND http_status <> 403) OR (http_status = 0 AND checked_at IS NOT NULL))::int`,
        brokenUrls: sql<string[]>`array_agg(DISTINCT dest_url) FILTER (WHERE (http_status >= 400 AND http_status <> 403) OR (http_status = 0 AND checked_at IS NOT NULL))`,
    })
    .from(qaLinksTable)
    .where(
      and(
        pageCondition,
        or(
          gt(qaLinksTable.httpStatus, 399),
          and(eq(qaLinksTable.httpStatus, 0), isNotNull(qaLinksTable.checkedAt)),
        ),
      )
    )
    .groupBy(qaLinksTable.sourceUrl)
     .orderBy(desc(sql`COUNT(*) FILTER (WHERE (http_status >= 400 AND http_status <> 403) OR (http_status = 0 AND checked_at IS NOT NULL))`))
    .limit(limit)
    .offset(offset);

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(DISTINCT source_url)::int` })
    .from(qaLinksTable)
    .where(
      and(
        pageCondition,
        or(
          gt(qaLinksTable.httpStatus, 399),
          and(eq(qaLinksTable.httpStatus, 0), isNotNull(qaLinksTable.checkedAt)),
        ),
      )
    );

  res.json({ data: rows, total: countRow?.total ?? 0, page, limit });
});

/** GET /api/scans/:id/qa/priority-pages — pages by inlink count desc */
router.get("/scans/:id/qa/priority-pages", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const page = Math.max(1, parseInt(req.query["page"] as string ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query["limit"] as string ?? "50", 10)));
  const offset = (page - 1) * limit;
  const search = (req.query["search"] as string ?? "").trim();
  const pageCondition = search
    ? and(
        eq(qaPagesTable.scanId, id),
        sql`(url ILIKE ${"%" + search + "%"} OR title ILIKE ${"%" + search + "%"})`,
      )
    : eq(qaPagesTable.scanId, id);

  const rows = await db
    .select(qaPageFields)
    .from(qaPagesTable)
    .where(pageCondition)
    .orderBy(desc(qaPagesTable.inlinkCount), asc(qaPagesTable.url))
    .limit(limit)
    .offset(offset);

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(qaPagesTable)
    .where(pageCondition);

  res.json({ data: rows, total: countRow?.total ?? 0, page, limit });
});

/** GET /api/scans/:id/qa/issues — content quality issues derived from qa_pages */
router.get("/scans/:id/qa/issues", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const page = Math.max(1, parseInt(req.query["page"] as string ?? "1", 10));
  const limit = Math.min(500, Math.max(1, parseInt(req.query["limit"] as string ?? "50", 10)));
  const offset = (page - 1) * limit;
  const typeFilter = req.query["type"] as string | undefined;
  const searchFilter = ((req.query["search"] as string) ?? "").trim().toLowerCase();

  const allPages = await db
    .select({ id: qaPagesTable.id, url: qaPagesTable.url, title: qaPagesTable.title, h1: qaPagesTable.h1, metaDescription: qaPagesTable.metaDescription, wordCount: qaPagesTable.wordCount, httpStatus: qaPagesTable.httpStatus, inlinkCount: qaPagesTable.inlinkCount })
    .from(qaPagesTable)
    .where(eq(qaPagesTable.scanId, id));

  interface Issue { url: string; type: string; severity: "high" | "medium" | "low"; detail: string; inlinkCount: number; }
  const issues: Issue[] = [];

  for (const pg of allPages) {
    if (!pg.title || pg.title.trim() === "") {
      issues.push({ url: pg.url, type: "missing_title", severity: "high", detail: "Page has no <title> tag", inlinkCount: pg.inlinkCount });
    } else if (pg.title.length < 10) {
      issues.push({ url: pg.url, type: "short_title", severity: "medium", detail: `Title too short (${pg.title.length} chars): "${pg.title}"`, inlinkCount: pg.inlinkCount });
    } else if (pg.title.length > 70) {
      issues.push({ url: pg.url, type: "long_title", severity: "low", detail: `Title too long (${pg.title.length} chars)`, inlinkCount: pg.inlinkCount });
    }
    if (!pg.h1 || pg.h1.trim() === "") {
      issues.push({ url: pg.url, type: "missing_h1", severity: "high", detail: "Page has no <h1> heading", inlinkCount: pg.inlinkCount });
    }
    if (!pg.metaDescription || pg.metaDescription.trim() === "") {
      issues.push({ url: pg.url, type: "missing_meta_desc", severity: "medium", detail: "No meta description", inlinkCount: pg.inlinkCount });
    } else if (pg.metaDescription.length > 160) {
      issues.push({ url: pg.url, type: "long_meta_desc", severity: "low", detail: `Meta description too long (${pg.metaDescription.length} chars)`, inlinkCount: pg.inlinkCount });
    }
    if (pg.wordCount !== null && pg.wordCount < 50) {
      issues.push({ url: pg.url, type: "thin_content", severity: "medium", detail: `Very thin content (${pg.wordCount} words)`, inlinkCount: pg.inlinkCount });
    }
    if (pg.httpStatus !== null && pg.httpStatus >= 400 && pg.httpStatus !== 403) {
      issues.push({ url: pg.url, type: "http_error", severity: "high", detail: `HTTP ${pg.httpStatus} error page`, inlinkCount: pg.inlinkCount });
    }
  }

  const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => (sevOrder[a.severity] - sevOrder[b.severity]) || (b.inlinkCount - a.inlinkCount));

  const summary: Record<string, number> = {};
  for (const i of issues) { summary[i.type] = (summary[i.type] ?? 0) + 1; }

  const filtered = issues.filter((i) =>
    (!typeFilter || i.type === typeFilter) &&
    (!searchFilter || i.url.toLowerCase().includes(searchFilter) || i.detail.toLowerCase().includes(searchFilter)),
  );
  res.json({ data: filtered.slice(offset, offset + limit), total: filtered.length, page, limit, summary });
});

/** GET /api/scans/:id/qa/inventory-summary — aggregate counts per content category */
router.get("/scans/:id/qa/inventory-summary", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const [pagesRow] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(qaPagesTable)
    .where(eq(qaPagesTable.scanId, id));

  const [linksRow] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      internal: sql<number>`COUNT(*) FILTER (WHERE link_type = 'internal')::int`,
      external: sql<number>`COUNT(*) FILTER (WHERE link_type = 'external')::int`,
      email: sql<number>`COUNT(*) FILTER (WHERE dest_url ILIKE 'mailto:%')::int`,
      phone: sql<number>`COUNT(*) FILTER (WHERE dest_url ILIKE 'tel:%')::int`,
      document: sql<number>`COUNT(*) FILTER (WHERE dest_url ~* '\\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|csv)(\\?|#|$)')::int`,
      media: sql<number>`COUNT(*) FILTER (WHERE dest_url ~* '\\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff|mp4|webm|ogg|avi|mov|mp3|wav)(\\?|#|$)')::int`,
      javascript: sql<number>`COUNT(*) FILTER (WHERE dest_url ~* '\\.(js|mjs)(\\?|#|$)')::int`,
      css: sql<number>`COUNT(*) FILTER (WHERE dest_url ~* '\\.css(\\?|#|$)')::int`,
       broken: sql<number>`COUNT(*) FILTER (WHERE checked_at IS NOT NULL AND ((http_status >= 400 AND http_status <> 403) OR http_status = 0))::int`,
      redirects: sql<number>`COUNT(*) FILTER (WHERE is_redirect = true AND checked_at IS NOT NULL)::int`,
    })
    .from(qaLinksTable)
    .where(eq(qaLinksTable.scanId, id));

  res.json({
    pages: pagesRow?.total ?? 0,
    links: { total: linksRow?.total ?? 0, internal: linksRow?.internal ?? 0, external: linksRow?.external ?? 0, email: linksRow?.email ?? 0, phone: linksRow?.phone ?? 0, document: linksRow?.document ?? 0, media: linksRow?.media ?? 0, javascript: linksRow?.javascript ?? 0, css: linksRow?.css ?? 0, broken: linksRow?.broken ?? 0, redirects: linksRow?.redirects ?? 0 },
  });
});

/** GET /api/qa/sites — list sites that have at least one completed crawler scan */
router.get("/qa/sites", requireAuth, async (req, res): Promise<void> => {
  const user = req.session?.user;
  const accessibleSites = await getEffectiveSites(
    user?.id ?? 0,
    String(user?.id ?? 0),
    user?.role ?? "user",
  );
  const accessibleSiteIds = new Set(accessibleSites.map((site) => site.id));
  const rows = await db
    .select({
      siteId: sitesTable.id,
      siteName: sitesTable.name,
      siteUrl: sitesTable.baseUrl,
      crawlerSessionId: crawlerSessionsTable.id,
      scanId: crawlerSessionsTable.scanSessionId,
      crawledAt: crawlerSessionsTable.completedAt,
      pageCount: crawlerSessionsTable.totalScanned,
      brokenLinksCount: crawlerSessionsTable.brokenLinksCount,
    })
    .from(sitesTable)
    .innerJoin(
      crawlerSessionsTable,
      and(
        eq(crawlerSessionsTable.siteId, sitesTable.id),
        isNotNull(crawlerSessionsTable.scanSessionId)
      )
    )
    .orderBy(desc(crawlerSessionsTable.completedAt));

  // Deduplicate: one entry per site (latest crawl first)
  const seen = new Set<number>();
  const result = [];
  for (const row of rows) {
    if (!accessibleSiteIds.has(row.siteId)) continue;
    if (!seen.has(row.siteId)) {
      seen.add(row.siteId);
      result.push(row);
    }
  }
  res.json(result);
});

/** GET /api/qa/sites/:siteId/history — all completed crawler scans for a site */
router.get("/qa/sites/:siteId/history", requireAuth, async (req, res): Promise<void> => {
  const siteId = parseInt(req.params["siteId"] as string, 10);
  if (isNaN(siteId)) { res.status(400).json({ error: "Invalid site id" }); return; }

  const rows = await db
    .select({
      crawlerSessionId: crawlerSessionsTable.id,
      scanId: crawlerSessionsTable.scanSessionId,
      crawledAt: crawlerSessionsTable.completedAt,
      startedAt: crawlerSessionsTable.startedAt,
      pageCount: crawlerSessionsTable.totalScanned,
      totalDiscovered: crawlerSessionsTable.totalDiscovered,
      brokenLinksCount: crawlerSessionsTable.brokenLinksCount,
      status: crawlerSessionsTable.status,
    })
    .from(crawlerSessionsTable)
    .where(
      and(
        eq(crawlerSessionsTable.siteId, siteId),
        isNotNull(crawlerSessionsTable.scanSessionId)
      )
    )
    .orderBy(desc(crawlerSessionsTable.completedAt))
    .limit(50);

  res.json(rows);
});

/** GET /api/scans/:id/qa/unsafe-links — http:// links found on https:// pages */
router.get("/scans/:id/qa/unsafe-links", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt((req.query["limit"] as string) ?? "50", 10)));
  const offset = (page - 1) * limit;
  const search = ((req.query["search"] as string) ?? "").trim();
  const type = ((req.query["type"] as string) ?? "").trim();
  const unsafeCondition = and(
    eq(qaLinksTable.scanId, id),
    eq(qaLinksTable.isUnsafe, true),
    ...(search
      ? [sql`(source_url ILIKE ${"%" + search + "%"} OR dest_url ILIKE ${"%" + search + "%"} OR anchor_text ILIKE ${"%" + search + "%"})`]
      : []),
    ...(type ? [eq(qaLinksTable.linkType, type)] : []),
  );

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(qaLinksTable)
    .where(unsafeCondition);

  const rows = await db
    .select({
      sourceUrl: qaLinksTable.sourceUrl,
      destUrl: qaLinksTable.destUrl,
      anchorText: qaLinksTable.anchorText,
      linkType: qaLinksTable.linkType,
      httpStatus: qaLinksTable.httpStatus,
    })
    .from(qaLinksTable)
    .where(unsafeCondition)
    .orderBy(asc(qaLinksTable.sourceUrl))
    .limit(limit)
    .offset(offset);

  res.json({ total: countRow?.total ?? 0, page, limit, items: rows });
});

/** GET /api/scans/:id/qa/image-inventory — images collected during crawl */
router.get("/scans/:id/qa/image-inventory", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt((req.query["limit"] as string) ?? "50", 10)));
  const offset = (page - 1) * limit;
  const filter = (req.query["filter"] as string) ?? "all";

  let baseWhere = eq(qaImagesTable.scanId, id);
  if (filter === "broken") baseWhere = and(baseWhere, eq(qaImagesTable.isBroken, true)) as typeof baseWhere;
  else if (filter === "missing-alt") baseWhere = and(baseWhere, sql`(alt IS NULL OR alt = '')`) as typeof baseWhere;
  else if (filter === "external") baseWhere = and(baseWhere, eq(qaImagesTable.isExternal, true)) as typeof baseWhere;

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(qaImagesTable)
    .where(baseWhere);

  const rows = await db
    .select({
      id: qaImagesTable.id,
      sourceUrl: qaImagesTable.sourceUrl,
      src: qaImagesTable.src,
      alt: qaImagesTable.alt,
      width: qaImagesTable.width,
      height: qaImagesTable.height,
      isExternal: qaImagesTable.isExternal,
      httpStatus: qaImagesTable.httpStatus,
      isBroken: qaImagesTable.isBroken,
    })
    .from(qaImagesTable)
    .where(baseWhere)
    .orderBy(asc(qaImagesTable.sourceUrl))
    .limit(limit)
    .offset(offset);

  // Summary stats
  const [stats] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      broken: sql<number>`COUNT(*) FILTER (WHERE is_broken = true)::int`,
      missingAlt: sql<number>`COUNT(*) FILTER (WHERE alt IS NULL OR alt = '')::int`,
      external: sql<number>`COUNT(*) FILTER (WHERE is_external = true)::int`,
      unchecked: sql<number>`COUNT(*) FILTER (WHERE checked_at IS NULL)::int`,
    })
    .from(qaImagesTable)
    .where(eq(qaImagesTable.scanId, id));

  res.json({ total: countRow?.total ?? 0, page, limit, items: rows, stats: stats ?? { total: 0, broken: 0, missingAlt: 0, external: 0, unchecked: 0 } });
});

/** GET /api/scans/:id/qa/word-inventory — word frequency extracted from page body text */
router.get("/scans/:id/qa/word-inventory", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
  const limit = Math.min(500, Math.max(1, parseInt((req.query["limit"] as string) ?? "100", 10)));
  const offset = (page - 1) * limit;
  const search = ((req.query["search"] as string) ?? "").trim();

  const baseWhere = search
    ? and(eq(qaWordInventoryTable.scanId, id), ilike(qaWordInventoryTable.word, `%${search}%`))
    : eq(qaWordInventoryTable.scanId, id);

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(qaWordInventoryTable)
    .where(baseWhere);

  const rows = await db
    .select({
      word: qaWordInventoryTable.word,
      pageCount: qaWordInventoryTable.pageCount,
      totalCount: qaWordInventoryTable.totalCount,
    })
    .from(qaWordInventoryTable)
    .where(baseWhere)
    .orderBy(desc(qaWordInventoryTable.totalCount))
    .limit(limit)
    .offset(offset);

  res.json({ total: countRow?.total ?? 0, page, limit, items: rows });
});

/** GET /api/scans/:id/qa/sitemap — qa_pages rows with inSitemap status */
router.get("/scans/:id/qa/sitemap", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid scan id" }); return; }

  const pageNum = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt((req.query["limit"] as string) ?? "50", 10)));
  const offset = (pageNum - 1) * limit;
  const filter = (req.query["filter"] as string) ?? "all"; // "in-sitemap" | "not-in-sitemap" | "all"
  const search = ((req.query["search"] as string) ?? "").trim();

  let baseWhere = eq(qaPagesTable.scanId, id);
  if (filter === "in-sitemap") baseWhere = and(baseWhere, eq(qaPagesTable.inSitemap, true)) as typeof baseWhere;
  else if (filter === "not-in-sitemap") baseWhere = and(baseWhere, eq(qaPagesTable.inSitemap, false)) as typeof baseWhere;
  if (search) {
    baseWhere = and(
      baseWhere,
      sql`(url ILIKE ${"%" + search + "%"} OR title ILIKE ${"%" + search + "%"})`,
    ) as typeof baseWhere;
  }

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(qaPagesTable)
    .where(baseWhere);

  const rows = await db
    .select({
      url: qaPagesTable.url,
      title: qaPagesTable.title,
      inSitemap: qaPagesTable.inSitemap,
      httpStatus: qaPagesTable.httpStatus,
      wordCount: qaPagesTable.wordCount,
      scannedAt: qaPagesTable.scannedAt,
    })
    .from(qaPagesTable)
    .where(baseWhere)
    .orderBy(asc(qaPagesTable.url))
    .limit(limit)
    .offset(offset);

  const [stats] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      inSitemap: sql<number>`COUNT(*) FILTER (WHERE in_sitemap = true)::int`,
      notInSitemap: sql<number>`COUNT(*) FILTER (WHERE in_sitemap = false)::int`,
    })
    .from(qaPagesTable)
    .where(eq(qaPagesTable.scanId, id));

  res.json({ total: countRow?.total ?? 0, page: pageNum, limit, items: rows, stats: stats ?? { total: 0, inSitemap: 0, notInSitemap: 0 } });
});

export default router;
