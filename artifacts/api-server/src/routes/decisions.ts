import { Router, type IRouter } from "express";
import { db, pool, issueDecisionsTable, scanSessionsTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/authMiddleware";
import { z } from "zod";

const router: IRouter = Router();
const decisionColumns = {
  id: issueDecisionsTable.id, scanSessionId: issueDecisionsTable.scanSessionId, pageId: issueDecisionsTable.pageId,
  issueId: issueDecisionsTable.issueId, ruleId: issueDecisionsTable.ruleId, selector: issueDecisionsTable.selector,
  elementSnippet: issueDecisionsTable.elementSnippet, pageUrl: issueDecisionsTable.pageUrl, issueDescription: issueDecisionsTable.issueDescription,
  decisionType: issueDecisionsTable.decisionType, scope: issueDecisionsTable.scope, classPattern: issueDecisionsTable.classPattern,
  pagesAffected: issueDecisionsTable.pagesAffected, reason: issueDecisionsTable.reason, submittedBy: issueDecisionsTable.submittedBy,
  submitterName: issueDecisionsTable.submitterName, reviewStatus: issueDecisionsTable.reviewStatus, reviewedBy: issueDecisionsTable.reviewedBy,
  reviewerName: issueDecisionsTable.reviewerName, reviewComment: issueDecisionsTable.reviewComment, createdAt: issueDecisionsTable.createdAt, updatedAt: issueDecisionsTable.updatedAt,
};

const CreateDecisionBody = z.object({
  issueId: z.number().optional(),
  pageId: z.number().optional(),
  ruleId: z.string(),
  selector: z.string().optional(),
  classPattern: z.string().max(200).optional(),
  elementSnippet: z.string().max(2000).optional(),
  pageUrl: z.string().optional(),
  issueDescription: z.string().max(500).optional(),
  decisionType: z.enum(["cant_fix", "false_positive"]),
  scope: z.enum(["single", "selector", "class"]).default("single"),
  reason: z.string().max(1000).optional(),
});

// POST /api/scans/:scanId/decisions
router.post("/scans/:scanId/decisions", requireAuth, async (req, res): Promise<void> => {
  const scanId = parseInt(req.params.scanId as string, 10);
  if (isNaN(scanId)) { res.status(400).json({ error: "Invalid scan ID" }); return; }

  const parsed = CreateDecisionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const userId = req.session?.user?.id;
  const userName: string = (req.session?.user as { fullName?: string; username?: string })?.fullName
    || req.session?.user?.username
    || "Unknown";
  const d = parsed.data;

  // Normalize class pattern: ensure leading dot
  const normalizedClass = d.classPattern
    ? (d.classPattern.startsWith(".") ? d.classPattern : `.${d.classPattern}`)
    : undefined;

  // Compute pages affected for class-scope decisions
  let pagesAffected: number | null = null;
  if (d.scope === "class" && normalizedClass) {
    const client = await pool.connect();
    try {
      const result = await client.query<{ count: string }>(`
        SELECT COUNT(DISTINCT pr.id) AS count
        FROM page_results pr
        JOIN accessibility_issues ai ON ai.page_id = pr.id
        WHERE pr.scan_id = $1
          AND ai.rule_id = $2
          AND ai.selector LIKE $3
      `, [scanId, d.ruleId, `%${normalizedClass}%`]);
      pagesAffected = parseInt(result.rows[0]?.count ?? "0", 10);
    } finally {
      client.release();
    }
  }

  const [created] = await db.insert(issueDecisionsTable).values({
    scanSessionId: scanId,
    pageId: d.pageId,
    issueId: d.issueId,
    ruleId: d.ruleId,
    selector: d.selector,
    classPattern: normalizedClass ?? null,
    elementSnippet: d.elementSnippet,
    pageUrl: d.pageUrl,
    issueDescription: d.issueDescription,
    decisionType: d.decisionType,
    scope: d.scope,
    pagesAffected,
    reason: d.reason ?? null,
    submittedBy: Number(userId),
    submitterName: userName,
  }).returning();

  res.json(created);
});

// GET /api/scans/:scanId/decisions
router.get("/scans/:scanId/decisions", requireAuth, async (req, res): Promise<void> => {
  const scanId = parseInt(req.params.scanId as string, 10);
  if (isNaN(scanId)) { res.status(400).json({ error: "Invalid scan ID" }); return; }

  const rows = await db.select(decisionColumns).from(issueDecisionsTable)
    .where(eq(issueDecisionsTable.scanSessionId, scanId))
    .orderBy(desc(issueDecisionsTable.createdAt));

  res.json(rows);
});

// DELETE /api/decisions/:id  (undo)
router.delete("/decisions/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const userId = req.session?.user?.id;
  const role = req.session?.user?.role;
  const isAdmin = role === "super_admin" || role === "admin";

  const existing = await db.select(decisionColumns).from(issueDecisionsTable)
    .where(eq(issueDecisionsTable.id, id)).limit(1);
  if (!existing[0]) { res.status(404).json({ error: "Decision not found" }); return; }
  if (!isAdmin && existing[0].submittedBy !== Number(userId)) {
    res.status(403).json({ error: "Access denied" }); return;
  }

  await db.delete(issueDecisionsTable).where(eq(issueDecisionsTable.id, id));
  res.json({ ok: true });
});

// PUT /api/decisions/:id/review  (admin: confirm or reject)
router.put("/decisions/:id/review", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const role = req.session?.user?.role;
  if (role !== "super_admin" && role !== "admin") {
    res.status(403).json({ error: "Admin access required" }); return;
  }

  const parsed = z.object({
    reviewStatus: z.enum(["confirmed", "rejected"]),
    reviewComment: z.string().max(1000).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const userId = req.session?.user?.id;
  const userName: string = (req.session?.user as { fullName?: string; username?: string })?.fullName
    || req.session?.user?.username
    || "Unknown";

  const [updated] = await db.update(issueDecisionsTable)
    .set({
      reviewStatus: parsed.data.reviewStatus,
      reviewComment: parsed.data.reviewComment ?? null,
      reviewedBy: Number(userId),
      reviewerName: userName,
      updatedAt: new Date(),
    })
    .where(eq(issueDecisionsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Decision not found" }); return; }
  res.json(updated);
});

// GET /api/decisions  (activity page — all decisions; admins see all, users see own)
router.get("/decisions", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session?.user?.id;
  const role = req.session?.user?.role;
  const isAdmin = role === "super_admin" || role === "admin";
  const decisionType = req.query.decisionType as string | undefined;
  const siteId = req.query.siteId ? parseInt(req.query.siteId as string, 10) : null;

  const conditions = [];
  if (!isAdmin) conditions.push(eq(issueDecisionsTable.submittedBy, Number(userId)));
  if (decisionType) conditions.push(eq(issueDecisionsTable.decisionType, decisionType));

  if (siteId) {
    // Filter decisions to only those whose scan session belongs to the specified site
    const scanIds = await db
      .select({ id: scanSessionsTable.id })
      .from(scanSessionsTable)
      .where(eq(scanSessionsTable.siteId, siteId));
    const ids = scanIds.map((s) => s.id);
    if (ids.length === 0) {
      res.json([]);
      return;
    }
    conditions.push(inArray(issueDecisionsTable.scanSessionId, ids));
  }

  const rows = await db.select(decisionColumns).from(issueDecisionsTable)
    .where(conditions.length > 0 ? and(...(conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]))  : undefined)
    .orderBy(desc(issueDecisionsTable.createdAt))
    .limit(500);

  res.json(rows);
});

export default router;
