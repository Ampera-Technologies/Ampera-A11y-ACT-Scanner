import {
  db,
  pool,
  scanSessionsTable,
  pageResultsTable,
  pageInteractionStatesTable,
  accessibilityIssuesTable,
  appSettingsTable,
  qaPagesTable,
  qaLinksTable,
  qaImagesTable,
  ruleExecutionStatusesTable,
} from "@workspace/db";
import { eq, and, sql, or, inArray, notInArray, lt } from "drizzle-orm";
import { scanPage, resetBrowserInstance, setScanConcurrency, fetchRawHtmlViaBrowser } from "./scanner";
import { runQALinkChecker } from "./qaLinkChecker";
import { logger } from "./logger";
import { randomBytes } from "crypto";
import { enqueueIssueAssessments, shouldQueueAIAssessments } from "./ai-assessment";
import {
  classifyStaticHtml,
  hashPreflightHtml,
  redactProvenanceUrl,
  runStaticHtmlPreflight,
  shouldRunStaticPreflight,
  type StaticHtmlPreflight,
} from "./httpPreflight";
import {
  getRuleExecutionStatuses,
  getSelectedRuleIds,
  normalizeRuleId,
  RULE_REGISTRY,
  reconcileRuleExecutionStatuses,
  type RuleExecutionStatus,
} from "./browser/registry";

async function persistRuleStatuses(
  pageId: number,
  statuses: readonly RuleExecutionStatus[],
  carriedForward = false,
): Promise<void> {
  if (!statuses.length) return;
  const values = statuses.map((status) =>
    `(${pageId}, '${status.ruleId.replace(/'/g, "''")}', '${status.status}', '${status.executionTier}', ${carriedForward})`,
  ).join(",");
  await pool.query(
    `INSERT INTO rule_execution_statuses
       (page_result_id, rule_id, status, execution_tier, carried_forward)
     VALUES ${values}
     ON CONFLICT (page_result_id, rule_id) DO UPDATE SET
       status = EXCLUDED.status, execution_tier = EXCLUDED.execution_tier,
       carried_forward = EXCLUDED.carried_forward`,
  );
}

const accessibilityIssueFields = {
  id: accessibilityIssuesTable.id,
  pageId: accessibilityIssuesTable.pageId,
  ruleId: accessibilityIssuesTable.ruleId,
  ruleType: accessibilityIssuesTable.ruleType,
  impact: accessibilityIssuesTable.impact,
  description: accessibilityIssuesTable.description,
  element: accessibilityIssuesTable.element,
  elementContext: accessibilityIssuesTable.elementContext,
  wcagCriteria: accessibilityIssuesTable.wcagCriteria,
  wcagLevel: accessibilityIssuesTable.wcagLevel,
  legalText: accessibilityIssuesTable.legalText,
  selector: accessibilityIssuesTable.selector,
  remediation: accessibilityIssuesTable.remediation,
  bboxX: accessibilityIssuesTable.bboxX,
  bboxY: accessibilityIssuesTable.bboxY,
  bboxWidth: accessibilityIssuesTable.bboxWidth,
  bboxHeight: accessibilityIssuesTable.bboxHeight,
  interactionStateId: accessibilityIssuesTable.interactionStateId,
  falsePositive: accessibilityIssuesTable.falsePositive,
  falsePositiveNote: accessibilityIssuesTable.falsePositiveNote,
};

const pageInteractionStateFields = {
  id: pageInteractionStatesTable.id,
  pageId: pageInteractionStatesTable.pageId,
  stateKey: pageInteractionStatesTable.stateKey,
  triggerSelector: pageInteractionStatesTable.triggerSelector,
  triggerLabel: pageInteractionStatesTable.triggerLabel,
  screenshot: pageInteractionStatesTable.screenshot,
  pageHtml: pageInteractionStatesTable.pageHtml,
};

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
};

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
};

const qaImageFields = {
  id: qaImagesTable.id,
  scanId: qaImagesTable.scanId,
  sourceUrl: qaImagesTable.sourceUrl,
  src: qaImagesTable.src,
  alt: qaImagesTable.alt,
  width: qaImagesTable.width,
  height: qaImagesTable.height,
  isExternal: qaImagesTable.isExternal,
  httpStatus: qaImagesTable.httpStatus,
  isBroken: qaImagesTable.isBroken,
  checkedAt: qaImagesTable.checkedAt,
};

const pageResultFields = {
  id: pageResultsTable.id,
  scanId: pageResultsTable.scanId,
  url: pageResultsTable.url,
  status: pageResultsTable.status,
  issueCount: pageResultsTable.issueCount,
  criticalCount: pageResultsTable.criticalCount,
  errorMessage: pageResultsTable.errorMessage,
  scannedAt: pageResultsTable.scannedAt,
  loadDurationMs: pageResultsTable.loadDurationMs,
  scanDurationMs: pageResultsTable.scanDurationMs,
  screenshot: pageResultsTable.screenshot,
  pageHtml: pageResultsTable.pageHtml,
  contentHash: pageResultsTable.contentHash,
  carriedForward: pageResultsTable.carriedForward,
  finalUrl: pageResultsTable.finalUrl,
  httpStatus: pageResultsTable.httpStatus,
  contentType: pageResultsTable.contentType,
  responseCapturedAt: pageResultsTable.responseCapturedAt,
  acquisitionMethod: pageResultsTable.acquisitionMethod,
  proxyStrategy: pageResultsTable.proxyStrategy,
  rawHtmlHash: pageResultsTable.rawHtmlHash,
  renderedDomHash: pageResultsTable.renderedDomHash,
};

// ── WAF token store ───────────────────────────────────────────────────────────
// Keyed by pageId → token data. Tokens expire after 10 minutes.
// Used by the Ampera WAF Scanner extension to authenticate local scan results.
export const wafPageTokens = new Map<number, { token: string; scanId: number; expires: number }>();
// Reverse index: token → pageId (for fast lookup on POST /local-results)
export const wafTokenIndex = new Map<string, { pageId: number; scanId: number; expires: number }>();

const WAF_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface ScanOptions {
  timeout?: number;
  /** Per-URL override for the post-load scan delay (ms). Falls back to DB setting when omitted. */
  scanDelayMs?: number;
  waitForNetworkIdle?: boolean;
  bypassCSP?: boolean;
  maxConcurrency?: number;
  rules?: string[];
  proxyPacUrl?: string;
  skipCompletedPages?: boolean;
  disableJavascript?: boolean;
  /** Incremental scan: skip pages whose raw HTML is unchanged since the last
   *  completed scan of the same URL, carrying the previous issues forward. */
  incremental?: boolean;
  /** Ask the configured external AI provider to assess each detected occurrence. Manual scans only. */
  aiContextualAssessment?: boolean;
  /** Internal crawler marker; never enable automatic assessments for these scans. */
  crawlerSessionId?: number;
  source?: string;
}

// ── Incremental scan helpers ─────────────────────────────────────────────────
// Change detection uses a hash of the RAW (pre-JavaScript) HTML fetched with a
// plain HTTP GET — cheap enough to run for every page. Script bodies and
// whitespace are stripped so rotating nonces/CSRF tokens don't force rescans.

function hashRawHtml(html: string): string {
  return hashPreflightHtml(html);
}

/**
 * If the URL's raw content hash matches the newest completed result from a
 * previous scan, copy that result (issues, counts, HTML, screenshot) into the
 * current page row and mark it carried_forward. Returns true when the page
 * was carried forward and needs no browser visit.
 */
/** URL as-is plus its with/without-trailing-slash twin, so lookups match regardless of how the URL was submitted. */
function urlVariants(url: string): string[] {
  const variants = [url];
  if (url.endsWith("/")) variants.push(url.slice(0, -1));
  else variants.push(`${url}/`);
  return variants;
}

export async function tryCarryForward(
  scanId: number,
  pageId: number,
  url: string,
  rawHash: string,
  options: ScanOptions,
  preflight?: StaticHtmlPreflight,
  provenance?: {
    finalUrl?: string | null;
    httpStatus?: number | null;
    contentType?: string | null;
    responseCapturedAt?: Date | null;
    acquisitionMethod?: string | null;
    proxyStrategy?: string | null;
    renderedDomHash?: string | null;
  },
): Promise<boolean> {
  const variants = [...new Set([
    ...urlVariants(url),
    ...urlVariants(redactProvenanceUrl(url)),
  ])];
  const [currentScan] = await db
    .select({
      userId: scanSessionsTable.userId,
      siteId: scanSessionsTable.siteId,
      projectId: scanSessionsTable.projectId,
      groupId: scanSessionsTable.groupId,
      options: scanSessionsTable.options,
    })
    .from(scanSessionsTable)
    .where(eq(scanSessionsTable.id, scanId))
    .limit(1);
  if (!currentScan) return false;
  const currentSource =
    currentScan.options &&
    typeof currentScan.options === "object" &&
    "source" in currentScan.options
      ? String((currentScan.options as Record<string, unknown>).source ?? "")
      : "";
  const [prev] = await db
    .select({
      id: pageResultsTable.id,
      scanId: pageResultsTable.scanId,
      issueCount: pageResultsTable.issueCount,
      criticalCount: pageResultsTable.criticalCount,
      screenshot: pageResultsTable.screenshot,
      pageHtml: pageResultsTable.pageHtml,
      loadDurationMs: pageResultsTable.loadDurationMs,
      finalUrl: pageResultsTable.finalUrl,
      httpStatus: pageResultsTable.httpStatus,
      contentType: pageResultsTable.contentType,
      responseCapturedAt: pageResultsTable.responseCapturedAt,
      acquisitionMethod: pageResultsTable.acquisitionMethod,
      proxyStrategy: pageResultsTable.proxyStrategy,
      rawHtmlHash: pageResultsTable.rawHtmlHash,
      renderedDomHash: pageResultsTable.renderedDomHash,
    })
    .from(pageResultsTable)
    .innerJoin(scanSessionsTable, eq(scanSessionsTable.id, pageResultsTable.scanId))
    .where(
      and(
        inArray(pageResultsTable.url, variants),
        eq(pageResultsTable.status, "completed"),
        sql`${pageResultsTable.errorMessage} IS NULL`,
        or(
          eq(pageResultsTable.contentHash, rawHash),
          eq(pageResultsTable.rawHtmlHash, rawHash),
        ),
        sql`${pageResultsTable.scanId} != ${scanId}`,
        sql`${scanSessionsTable.userId} IS NOT DISTINCT FROM ${currentScan.userId}`,
        sql`${scanSessionsTable.siteId} IS NOT DISTINCT FROM ${currentScan.siteId}`,
        sql`${scanSessionsTable.projectId} IS NOT DISTINCT FROM ${currentScan.projectId}`,
        sql`${scanSessionsTable.groupId} IS NOT DISTINCT FROM ${currentScan.groupId}`,
        sql`COALESCE(${scanSessionsTable.options}->>'source', '') = ${currentSource}`,
      ),
    )
    .orderBy(sql`${pageResultsTable.id} DESC`)
    .limit(1);
  if (!prev) return false;

  let carriedIssueIds: number[] = [];
  const carried = await db.transaction(async (tx) => {
   const prevIssues = await tx
    .select(accessibilityIssueFields)
    .from(accessibilityIssuesTable)
    .where(eq(accessibilityIssuesTable.pageId, prev.id));
  const selectedRuleIds = getSelectedRuleIds(options.rules);
  const carriedIssues = selectedRuleIds
    ? prevIssues.filter((issue) => selectedRuleIds.has(normalizeRuleId(issue.ruleId)))
    : prevIssues;
  const carriedCriticalCount = carriedIssues.filter(
    (issue) => issue.impact === "critical",
  ).length;

  const interactionStateIds = new Map<number, number>();
  const previousStates = await tx
    .select(pageInteractionStateFields)
    .from(pageInteractionStatesTable)
    .where(eq(pageInteractionStatesTable.pageId, prev.id));
  if (previousStates.length > 0) {
    const copiedStates = await tx
      .insert(pageInteractionStatesTable)
      .values(
        previousStates.map(({ id: _id, pageId: _pageId, ...state }) => ({
          ...state,
          pageId,
        })),
      )
      .returning({
        id: pageInteractionStatesTable.id,
        stateKey: pageInteractionStatesTable.stateKey,
      });
    const copiedByKey = new Map(
      copiedStates.map((state) => [state.stateKey, state.id]),
    );
    for (const previousState of previousStates) {
      const copiedId = copiedByKey.get(previousState.stateKey);
      if (copiedId) interactionStateIds.set(previousState.id, copiedId);
    }
  }

  if (carriedIssues.length > 0) {
    const copiedIssues = await tx.insert(accessibilityIssuesTable).values(
      carriedIssues.map(({ id: _id, pageId: _pageId, interactionStateId, ...rest }) => ({
        ...rest,
        pageId,
        interactionStateId: interactionStateId
          ? interactionStateIds.get(interactionStateId) ?? null
          : null,
      })),
    ) .returning({ id: accessibilityIssuesTable.id });
    carriedIssueIds = copiedIssues.map((issue) => issue.id);
  }

  // Carry forward QA artifacts (page metadata, links, images) so incremental
  // scans produce complete QA datasets, not just accessibility issues.
  try {
    const [prevQaPage] = await tx
      .select(qaPageFields)
      .from(qaPagesTable)
      .where(and(eq(qaPagesTable.scanId, prev.scanId), inArray(qaPagesTable.url, variants)))
      .orderBy(sql`${qaPagesTable.id} DESC`)
      .limit(1);
    if (prevQaPage) {
      const [existing] = await tx
        .select({ id: qaPagesTable.id })
        .from(qaPagesTable)
        .where(and(eq(qaPagesTable.scanId, scanId), inArray(qaPagesTable.url, variants)))
        .limit(1);
      if (!existing) {
        const { id: _id, scanId: _sid, ...qaRest } = prevQaPage;
        await tx.insert(qaPagesTable).values({
          ...qaRest,
          scanId,
          url: redactProvenanceUrl(qaRest.url),
        });
      }
    }
    const prevLinks = await tx
      .select(qaLinkFields)
      .from(qaLinksTable)
      .where(and(eq(qaLinksTable.scanId, prev.scanId), inArray(qaLinksTable.sourceUrl, variants)));
    if (prevLinks.length > 0) {
      await tx.insert(qaLinksTable).values(
        prevLinks.map(({ id: _id, scanId: _sid, ...rest }) => ({
          ...rest,
          scanId,
          sourceUrl: redactProvenanceUrl(rest.sourceUrl),
          destUrl: redactProvenanceUrl(rest.destUrl),
        })),
      );
    }
    const prevImages = await tx
      .select(qaImageFields)
      .from(qaImagesTable)
      .where(and(eq(qaImagesTable.scanId, prev.scanId), inArray(qaImagesTable.sourceUrl, variants)));
    if (prevImages.length > 0) {
      await tx.insert(qaImagesTable).values(
        prevImages.map(({ id: _id, scanId: _sid, ...rest }) => ({
          ...rest,
          scanId,
          sourceUrl: redactProvenanceUrl(rest.sourceUrl),
          src: redactProvenanceUrl(rest.src),
        })),
      );
    }
  } catch (qaErr) {
    throw new Error(`Incremental QA carry-forward failed: ${String(qaErr)}`);
  }

  // Carry forward rule_page_stats so scoring uses true CRr even on unchanged pages
  try {
    const prevStatsResult = await tx.execute(
      sql`SELECT rule_id, total_checked, scope FROM rule_page_stats WHERE page_result_id = ${prev.id}`,
    ) as unknown as { rows: Array<{ rule_id: string; total_checked: number; scope: string }> };
    const prevStatsRows = prevStatsResult.rows;
    if (prevStatsRows.length > 0) {
      const carriedStats = selectedRuleIds
        ? prevStatsRows.filter((row) => selectedRuleIds.has(normalizeRuleId(row.rule_id)))
        : prevStatsRows;
      const registryIds = new Set(RULE_REGISTRY.map((rule) => rule.id));
      const currentStats = carriedStats.filter((row) => registryIds.has(normalizeRuleId(row.rule_id)));
      const vals = currentStats
        .map((r) => `(${pageId}, '${normalizeRuleId(r.rule_id).replace(/'/g, "''")}', ${r.total_checked}, '${r.scope}')`)
        .join(",");
      if (vals) {
        await tx.execute(sql.raw(
          `INSERT INTO rule_page_stats (page_result_id, rule_id, total_checked, scope)
           VALUES ${vals}
           ON CONFLICT (page_result_id, rule_id) DO NOTHING`,
        ));
      }
    }
  } catch (statsCarryErr) {
    throw new Error(`Incremental rule applicability carry-forward failed: ${String(statsCarryErr)}`);
  }

  // Carry forward the registry decisions as well. Recompute the selection
  // filter from this scan's options so changing scope never resurrects a
  // previously selected rule.
  try {
    const previousStatuses = await tx
      .select({
        rule_id: ruleExecutionStatusesTable.ruleId,
        status: ruleExecutionStatusesTable.status,
        execution_tier: ruleExecutionStatusesTable.executionTier,
      })
      .from(ruleExecutionStatusesTable)
      .where(eq(ruleExecutionStatusesTable.pageResultId, prev.id));
    const selected = getSelectedRuleIds(options.rules);
    const previousByRule = new Map(
      previousStatuses.map((row) => [row.rule_id.toUpperCase(), row]),
    );
    const reconciled = reconcileRuleExecutionStatuses(
      [...previousByRule.values()].map((row) => ({
        ruleId: row.rule_id,
        status: row.status as RuleExecutionStatus["status"],
        executionTier: row.execution_tier as RuleExecutionStatus["executionTier"],
      })),
      selected,
    );
    if (reconciled.length > 0) {
      await tx.insert(ruleExecutionStatusesTable)
        .values(reconciled.map((status) => ({
          pageResultId: pageId,
          ruleId: status.ruleId,
          status: status.status,
          executionTier: status.executionTier,
          carriedForward: true,
        })))
        .onConflictDoUpdate({
          target: [ruleExecutionStatusesTable.pageResultId, ruleExecutionStatusesTable.ruleId],
          set: {
            status: sql`excluded.status`,
            executionTier: sql`excluded.execution_tier`,
            carriedForward: true,
          },
        });
    }
  } catch (statusCarryErr) {
    throw new Error(`Incremental rule execution status carry-forward failed: ${String(statusCarryErr)}`);
  }

  // Mark skipped only after every evidence copy has succeeded. The caller
  // falls through to a fresh browser scan if any preceding operation throws.
  await tx
    .update(pageResultsTable)
    .set({
      status: "completed",
      issueCount: carriedIssues.length,
      criticalCount: carriedCriticalCount,
      errorMessage: null,
      scannedAt: new Date(),
      loadDurationMs: prev.loadDurationMs,
      scanDurationMs: 0,
      screenshot: prev.screenshot,
      pageHtml: prev.pageHtml,
      contentHash: rawHash,
      finalUrl: preflight?.finalUrl ?? provenance?.finalUrl ?? null,
      httpStatus: preflight?.status ?? provenance?.httpStatus ?? null,
      contentType: preflight?.contentType ?? provenance?.contentType ?? null,
      responseCapturedAt: preflight?.capturedAt ?? provenance?.responseCapturedAt ?? new Date(),
      acquisitionMethod: preflight?.acquisitionMethod ?? provenance?.acquisitionMethod ?? "chromium",
      proxyStrategy: preflight?.proxyStrategy ?? provenance?.proxyStrategy ?? (options.proxyPacUrl ? "configured_pac" : "direct"),
      rawHtmlHash: rawHash,
      renderedDomHash: provenance?.renderedDomHash ?? prev.renderedDomHash,
      carriedForward: true,
    })
    .where(eq(pageResultsTable.id, pageId));

  logger.info(
    { scanId, pageId, url, fromPageId: prev.id, issueCount: carriedIssues.length },
    "Incremental: page unchanged — issues carried forward without browser visit",
  );
   return true;
  });
  if (carriedIssueIds.length > 0 && shouldQueueAIAssessments(options)) {
    void enqueueIssueAssessments(carriedIssueIds, url, prev.pageHtml)
      .catch((err) => logger.warn({ scanId, pageId, err }, "AI assessments could not be queued for carried-forward issues"));
  }
  return carried;
}

/** Read the configured browser pool size (app_settings.scan_concurrency, default 4, max 8). */
async function getScanConcurrencySetting(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "scan_concurrency"));
    const parsed = parseInt(row?.value ?? "", 10);
    return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 8) : 4;
  } catch {
    return 4;
  }
}

async function getSystemProxyPacUrl(): Promise<string> {
  try {
    const [row] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "active_proxy_pac"));
    return row?.value?.trim() ?? "";
  } catch {
    return "";
  }
}

async function getGlobalScanDelayMs(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "scan_page_timeout_ms"));
    const parsed = parseInt(row?.value ?? "", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10_000;
  } catch {
    return 10_000;
  }
}

const activeScanControllers = new Map<number, AbortController>();
const activeScanRuns = new Set<Promise<void>>();
let scanShutdownRequested = false;
const pausedScans = new Set<number>();
const queuedRetryUrls = new Map<number, Set<string>>();
// Tracks how many times each URL has been auto-retried within the current scan run
const autoRetryCounters = new Map<number, Map<string, number>>();
const MAX_AUTO_RETRIES = 3; // total auto-retry attempts per URL before giving up
// URLs where the proxy itself failed (broken proxy) — skip fallback proxy on subsequent retries
const proxyFailedUrls = new Map<number, Set<string>>();
// URLs injected mid-scan via addUrlsToRunningScan — drained by the Phase 1 loop
const injectedUrlQueue = new Map<number, string[]>();
// Page IDs marked for removal while they are still waiting in the live queue.
// The worker checks this after resolving a URL row, closing the small race
// between queue dequeue and the database delete request.
const removedQueuedPageIds = new Map<number, Set<number>>();

function getLegalText(legal?: { ada: string[]; eaa: boolean }): string {
  if (!legal) return "";
  const parts: string[] = [];
  if (legal.ada?.length) parts.push(`ADA ${legal.ada.join(", ")}`);
  if (legal.eaa) parts.push("EAA");
  return parts.join(", ");
}

async function setPageStatus(pageId: number, status: string): Promise<void> {
  await db
    .update(pageResultsTable)
    .set({ status })
    .where(eq(pageResultsTable.id, pageId));
}

async function waitIfPaused(
  scanId: number,
  controller: AbortController,
): Promise<boolean> {
  if (!pausedScans.has(scanId)) return true;
  logger.info({ scanId }, "Scan paused — waiting for resume");
  while (pausedScans.has(scanId) && !controller.signal.aborted) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (controller.signal.aborted) return false;
  logger.info({ scanId }, "Scan resumed");
  await db
    .update(scanSessionsTable)
    .set({ status: "running" })
    .where(eq(scanSessionsTable.id, scanId));
  return true;
}

async function runScan(
  scanId: number,
  urls: string[],
  options: ScanOptions = {},
): Promise<void> {
  if (scanShutdownRequested) return;
  const controller = new AbortController();
  activeScanControllers.set(scanId, controller);

  const configuredConcurrency = await getScanConcurrencySetting();
  const maxConcurrency = options.maxConcurrency ?? configuredConcurrency;
  // Size the browser pool to match so batches actually run in parallel.
  setScanConcurrency(maxConcurrency);

  try {
    await db
      .update(scanSessionsTable)
      .set({ status: "running" })
      .where(eq(scanSessionsTable.id, scanId));

    logger.info({ scanId, urlCount: urls.length }, "Starting scan session");

    // ── Phase 1: process the initial URL list (dynamic — new URLs may be injected) ──
    const liveQueue = [...urls];
    let qi = 0;
    while (qi < liveQueue.length) {
      if (controller.signal.aborted) {
        logger.info({ scanId }, "Scan cancelled by user");
        break;
      }
      if (!(await waitIfPaused(scanId, controller))) break;

      // Drain any URLs injected mid-scan via addUrlsToRunningScan
      const injected = injectedUrlQueue.get(scanId);
      if (injected && injected.length > 0) {
        liveQueue.push(...injected.splice(0));
        logger.info(
          { scanId, count: liveQueue.length - qi },
          "Injected URLs appended to live queue",
        );
      }

      const batch = liveQueue.slice(qi, qi + maxConcurrency);
      qi += maxConcurrency;
      await Promise.all(
        batch.map((url) =>
          scanSinglePage(scanId, url, options, controller.signal),
        ),
      );
    }

    // Final drain — pick up URLs injected right as the loop was finishing
    const finalInjected = injectedUrlQueue.get(scanId);
    if (
      finalInjected &&
      finalInjected.length > 0 &&
      !controller.signal.aborted
    ) {
      const extra = finalInjected.splice(0);
      logger.info(
        { scanId, count: extra.length },
        "Processing URLs injected after Phase 1 completion",
      );
      for (let i = 0; i < extra.length; i += maxConcurrency) {
        if (controller.signal.aborted) break;
        if (!(await waitIfPaused(scanId, controller))) break;
        const batch = extra.slice(i, i + maxConcurrency);
        await Promise.all(
          batch.map((url) =>
            scanSinglePage(scanId, url, options, controller.signal),
          ),
        );
      }
    }

    // ── Phase 2: drain the retry queue ────────────────────────────────────
    // Failed URLs get added to queuedRetryUrls inside scanSinglePage.
    // Keep processing batches from the queue until it is empty or the scan
    // is cancelled.  Each pass through scanSinglePage may re-add the URL
    // (up to MAX_AUTO_RETRIES times) so we loop until the set is empty.
    while (!controller.signal.aborted) {
      const queued = queuedRetryUrls.get(scanId);
      if (!queued || queued.size === 0) break;

      if (!(await waitIfPaused(scanId, controller))) break;

      // Snapshot the current queue — scanSinglePage removes each URL from
      // the set at start, and may re-add it at end if another retry is needed.
      const retryBatch = Array.from(queued).slice(0, maxConcurrency);
      logger.info({ scanId, retryBatch }, "Processing retry queue batch");
      // skipCompletedPages: true — never re-scan a URL that succeeded while it
      // was waiting in the retry queue (e.g. completed by a concurrent Phase 1 worker).
      await Promise.all(
        retryBatch.map((url) =>
          scanSinglePage(
            scanId,
            url,
            { ...options, skipCompletedPages: true },
            controller.signal,
          ),
        ),
      );
    }

    // ── Phase 3: post-cycle retry loop (up to 5 rounds) ──────────────────────
    // After Phase 1 + 2, retry every page still marked not_available or failed.
    // We loop up to MAX_PHASE3_RETRIES times so transient blips, slow deploys,
    // or brief CDN hiccups have multiple chances to clear.  The scan is never
    // marked "completed" until all retry rounds are finished (or aborted).
    // Safety valve: if two consecutive rounds show ZERO improvement (same
    // failure count) we stop early — the site is likely unreachable.
    const MAX_PHASE3_RETRIES = 5;
    let prevPhase3FailedCount = -1; // sentinel: first round has no prior count
    let consecutiveNoProgress = 0;

    for (let round = 1; round <= MAX_PHASE3_RETRIES; round++) {
      if (controller.signal.aborted) break;

      const failedRows = await db
        .select({ url: pageResultsTable.url })
        .from(pageResultsTable)
        .where(
          and(
            eq(pageResultsTable.scanId, scanId),
            or(
              eq(pageResultsTable.status, "not_available"),
              eq(pageResultsTable.status, "failed"),
            ),
          ),
        );

      if (failedRows.length === 0) {
        logger.info(
          { scanId, round },
          "Phase 3: no failed/not_available pages remaining — stopping early",
        );
        break;
      }

      // Bail only when TWO consecutive rounds produced zero improvement —
      // this avoids abandoning a slow site after a single unlucky round while
      // still protecting against a truly unreachable target.
      if (
        prevPhase3FailedCount !== -1 &&
        failedRows.length >= prevPhase3FailedCount
      ) {
        consecutiveNoProgress++;
      } else {
        consecutiveNoProgress = 0; // improvement this round — reset counter
      }
      prevPhase3FailedCount = failedRows.length;

      if (consecutiveNoProgress >= 2) {
        logger.warn(
          {
            scanId,
            failedCount: failedRows.length,
            round,
            consecutiveNoProgress,
          },
          "Phase 3 aborted — no improvement over 2 consecutive rounds, site likely unreachable",
        );
        break;
      }

      const requeueUrls = failedRows.map((r) => r.url);
      logger.info(
        { scanId, round, max: MAX_PHASE3_RETRIES, count: requeueUrls.length },
        "Phase 3 retry round starting",
      );

      // Mark as "requeued" so the UI reflects that another attempt is in progress.
      await db
        .update(pageResultsTable)
        .set({ status: "requeued" })
        .where(
          and(
            eq(pageResultsTable.scanId, scanId),
            or(
              eq(pageResultsTable.status, "not_available"),
              eq(pageResultsTable.status, "failed"),
            ),
          ),
        );

      // Phase 3 retries one URL at a time (concurrency=1), not the scan's
      // normal maxConcurrency.  Concurrent retries cause cascade failures:
      // a TargetCloseError on one page destroys the browser context that
      // adjacent concurrent pages are using at the same moment.
      // Serialising ensures each URL gets a clean browser state.
      //
      // We also add a 10 s inter-round warm-up delay before each Phase 3
      // round to let Cloudflare bot-detection trust accumulate in the
      // persistent Chrome profile and give Chrome time to fully restart
      // after a resetBrowserInstance() call.
      const PHASE3_INTER_ROUND_DELAY_MS = 10_000;
      logger.info(
        { scanId, round, delayMs: PHASE3_INTER_ROUND_DELAY_MS },
        "Phase 3: waiting before retry round to let browser recover",
      );
      await new Promise((r) => setTimeout(r, PHASE3_INTER_ROUND_DELAY_MS));

      for (let i = 0; i < requeueUrls.length; i++) {
        if (controller.signal.aborted) break;
        if (!(await waitIfPaused(scanId, controller))) break;
        const url = requeueUrls[i];
        logger.info({ scanId, round, url, i: i + 1, total: requeueUrls.length }, "Phase 3 retry");
        // skipCompletedPages: true — Phase 3 must never re-scan a page that
        // already completed successfully, even if a duplicate failed row exists.
        await scanSinglePage(
          scanId,
          url,
          { ...options, skipCompletedPages: true },
          controller.signal,
          true,
        );
      }

      // Recompute session totals from DB after every round so the UI stays accurate.
      const [totals] = await db
        .select({
          totalIssues: sql<number>`COALESCE(SUM(issue_count), 0)`,
          criticalIssues: sql<number>`COALESCE(SUM(critical_count), 0)`,
          scannedUrls: sql<number>`COUNT(*) FILTER (WHERE status = 'completed')`,
          failedUrls: sql<number>`COUNT(*) FILTER (WHERE status IN ('failed', 'not_available'))`,
        })
        .from(pageResultsTable)
        .where(eq(pageResultsTable.scanId, scanId));

      if (totals) {
        await db
          .update(scanSessionsTable)
          .set({
            totalIssues: Number(totals.totalIssues),
            criticalIssues: Number(totals.criticalIssues),
            scannedUrls: Number(totals.scannedUrls),
            failedUrls: Number(totals.failedUrls),
          })
          .where(eq(scanSessionsTable.id, scanId));
        logger.info(
          { scanId, round, totals },
          "Phase 3 round totals recomputed",
        );
      }
    }

    // Before closing out, reset any pages still in a non-terminal status
    // (pending, requeued, running, navigating, scanning, rendering, analyzing,
    // saving) to not_available so they surface in the UI "Not Available" tile
    // instead of silently disappearing from the results.
    const TERMINAL_STATUSES = ["completed", "failed", "not_available"] as const;
    const resetResult = await db
      .update(pageResultsTable)
      .set({
        status: "not_available",
        errorMessage: "Page was not reached before the scan ended",
      })
      .where(
        and(
          eq(pageResultsTable.scanId, scanId),
          notInArray(pageResultsTable.status, [...TERMINAL_STATUSES]),
        ),
      );
    if (resetResult.rowCount && resetResult.rowCount > 0) {
      logger.warn(
        { scanId, resetCount: resetResult.rowCount },
        "Reset non-terminal page rows to not_available on scan finish",
      );
    }

    // Recompute final session totals after the reset so counts are accurate.
    const [finalTotals] = await db
      .select({
        totalIssues: sql<number>`COALESCE(SUM(issue_count), 0)`,
        criticalIssues: sql<number>`COALESCE(SUM(critical_count), 0)`,
        scannedUrls: sql<number>`COUNT(*) FILTER (WHERE status = 'completed')`,
        failedUrls: sql<number>`COUNT(*) FILTER (WHERE status IN ('failed', 'not_available'))`,
      })
      .from(pageResultsTable)
      .where(eq(pageResultsTable.scanId, scanId));

    if (finalTotals) {
      await db
        .update(scanSessionsTable)
        .set({
          totalIssues: Number(finalTotals.totalIssues),
          criticalIssues: Number(finalTotals.criticalIssues),
          scannedUrls: Number(finalTotals.scannedUrls),
          failedUrls: Number(finalTotals.failedUrls),
        })
        .where(eq(scanSessionsTable.id, scanId));
    }

    const finalStatus = controller.signal.aborted ? "cancelled" : "completed";

    await db
      .update(scanSessionsTable)
      .set({
        status: finalStatus,
        completedAt: new Date(),
      })
      .where(eq(scanSessionsTable.id, scanId));

    logger.info({ scanId, status: finalStatus }, "Scan session finished");

    // Fire-and-forget QA link checker after successful scan
    if (finalStatus === "completed") {
      runQALinkChecker(scanId).catch((err) =>
        logger.error({ scanId, err }, "QA link checker failed"),
      );
    }
  } catch (err) {
    logger.error({ scanId, err }, "Scan session errored — determining final status from page results");
    // Don't blindly mark the whole session "failed": if the pages themselves
    // finished successfully and only a post-scan finalization step threw
    // (transient DB/network hiccup — common on Azure App Service), the scan
    // has real results and must be reported as completed.
    let finalStatus: "completed" | "failed" | "cancelled" =
      controller.signal.aborted ? "cancelled" : "failed";
    try {
      const [stats] = await db
        .select({
          completed: sql<number>`COUNT(*) FILTER (WHERE status = 'completed')`,
          nonTerminal: sql<number>`COUNT(*) FILTER (WHERE status NOT IN ('completed', 'failed', 'not_available'))`,
          totalIssues: sql<number>`COALESCE(SUM(issue_count), 0)`,
          criticalIssues: sql<number>`COALESCE(SUM(critical_count), 0)`,
          failedUrls: sql<number>`COUNT(*) FILTER (WHERE status IN ('failed', 'not_available'))`,
        })
        .from(pageResultsTable)
        .where(eq(pageResultsTable.scanId, scanId));
      if (
        !controller.signal.aborted &&
        stats &&
        Number(stats.completed) > 0 &&
        Number(stats.nonTerminal) === 0
      ) {
        finalStatus = "completed";
        logger.warn(
          { scanId, completedPages: Number(stats.completed), err: String(err) },
          "Post-scan error but all pages terminal with completions — marking scan completed",
        );
        await db
          .update(scanSessionsTable)
          .set({
            totalIssues: Number(stats.totalIssues),
            criticalIssues: Number(stats.criticalIssues),
            scannedUrls: Number(stats.completed),
            failedUrls: Number(stats.failedUrls),
          })
          .where(eq(scanSessionsTable.id, scanId));
      }
    } catch (statsErr) {
      logger.error({ scanId, statsErr }, "Could not read page stats after scan error");
    }
    await db
      .update(scanSessionsTable)
      .set({ status: finalStatus, completedAt: new Date() })
      .where(eq(scanSessionsTable.id, scanId));
  } finally {
    activeScanControllers.delete(scanId);
    pausedScans.delete(scanId);
    queuedRetryUrls.delete(scanId);
    autoRetryCounters.delete(scanId);
    injectedUrlQueue.delete(scanId);
    removedQueuedPageIds.delete(scanId);
    proxyFailedUrls.delete(scanId);
    // WAF tokens are intentionally kept alive until their TTL expires (10 min)
    // so the user can still click "Scan from Browser" on a completed scan.
    // Periodically purge globally expired tokens to avoid unbounded memory growth.
    const now = Date.now();
    for (const [pageId, entry] of wafPageTokens) {
      if (entry.expires < now) {
        wafTokenIndex.delete(entry.token);
        wafPageTokens.delete(pageId);
      }
    }
  }
}

/** Start a scan while retaining a settlement handle for graceful shutdown. */
export function startScan(
  scanId: number,
  urls: string[],
  options: ScanOptions = {},
): Promise<void> {
  if (scanShutdownRequested) return Promise.resolve();
  const run = runScan(scanId, urls, options);
  activeScanRuns.add(run);
  void run.then(
    () => activeScanRuns.delete(run),
    () => activeScanRuns.delete(run),
  );
  return run;
}

export async function waitForScanWork(timeoutMs: number): Promise<boolean> {
  if (activeScanRuns.size === 0) return true;
  const work = Promise.all([...activeScanRuns].map((run) => run.catch(() => undefined)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
  });
  const settled = await Promise.race([work.then(() => true), timeout]);
  if (timer) clearTimeout(timer);
  return settled;
}

export function queueRetryUrl(scanId: number, url: string): boolean {
  const controller = activeScanControllers.get(scanId);
  if (!controller || controller.signal.aborted) return false;
  if (!queuedRetryUrls.has(scanId)) queuedRetryUrls.set(scanId, new Set());
  queuedRetryUrls.get(scanId)?.add(url);
  return true;
}

/**
 * Inject additional URLs into a scan that is currently running, paused, or pending.
 * Inserts DB rows immediately (so status/progress reflects them) and feeds the
 * live Phase-1 queue so the worker picks them up without any restart.
 */
export async function addUrlsToRunningScan(
  scanId: number,
  urls: string[],
): Promise<{ added: number; skipped: number }> {
  // Deduplicate against existing page_results rows
  const existing = await db
    .select({ url: pageResultsTable.url })
    .from(pageResultsTable)
    .where(eq(pageResultsTable.scanId, scanId));

  const existingSet = new Set(existing.map((r) => r.url));
  const newUrls = urls.filter((u) => !existingSet.has(u));

  if (newUrls.length === 0) {
    return { added: 0, skipped: urls.length };
  }

  // Insert pending rows so the DB immediately reflects the new total
  await db
    .insert(pageResultsTable)
    .values(
      newUrls.map((url) => ({ scanId, url, status: "pending" as const })),
    );

  // Update total_urls on the session
  await db
    .update(scanSessionsTable)
    .set({ totalUrls: sql`${scanSessionsTable.totalUrls} + ${newUrls.length}` })
    .where(eq(scanSessionsTable.id, scanId));

  // Feed the live queue if the scan worker is still running
  if (!injectedUrlQueue.has(scanId)) injectedUrlQueue.set(scanId, []);
  injectedUrlQueue.get(scanId)!.push(...newUrls);

  logger.info(
    { scanId, added: newUrls.length, skipped: urls.length - newUrls.length },
    "URLs injected into running scan",
  );

  return { added: newUrls.length, skipped: urls.length - newUrls.length };
}

/**
 * Mark a queued URL for removal and remove it from the injected queue.
 * The database row is deleted by the route after this marker is set.
 */
export function removeQueuedUrl(
  scanId: number,
  pageId: number,
  url: string,
): void {
  let removed = removedQueuedPageIds.get(scanId);
  if (!removed) {
    removed = new Set<number>();
    removedQueuedPageIds.set(scanId, removed);
  }
  removed.add(pageId);

  const injected = injectedUrlQueue.get(scanId);
  if (injected) {
    injectedUrlQueue.set(
      scanId,
      injected.filter((queuedUrl) => queuedUrl !== url),
    );
  }
}

export function clearQueuedUrlRemoval(scanId: number, pageId: number): void {
  const removed = removedQueuedPageIds.get(scanId);
  removed?.delete(pageId);
  if (removed?.size === 0) removedQueuedPageIds.delete(scanId);
}

async function scanSinglePage(
  scanId: number,
  url: string,
  options: ScanOptions,
  signal: AbortSignal,
  skipCounterUpdates = false,
): Promise<void> {
  if (signal.aborted) return;

  // If the scan was paused while this page was already queued in a batch,
  // hold here until resumed (or cancelled) before touching any DB state.
  if (pausedScans.has(scanId)) {
    logger.info({ scanId, url }, "Page waiting — scan is paused");
    while (pausedScans.has(scanId) && !signal.aborted) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (signal.aborted) return;
  }

  // ── Resolve the page row ──────────────────────────────────────────────────
  // ORDER BY prefers the row that most needs to be worked on (requeued/failed/
  // not_available) over any already-completed duplicate, avoiding a race where
  // the completed row is accidentally selected and then overwritten by a retry.
  let pageRow: typeof pageResultsTable.$inferSelect | undefined;
  try {
    const rows = await db
      .select(pageResultFields)
      .from(pageResultsTable)
      .where(
        and(eq(pageResultsTable.scanId, scanId), eq(pageResultsTable.url, url)),
      )
      .orderBy(
        sql`CASE WHEN ${pageResultsTable.status} IN ('requeued','failed','not_available','pending') THEN 0 ELSE 1 END`,
        pageResultsTable.id,
      );
    pageRow = rows[0];
  } catch (err) {
    logger.error(
      { scanId, url, err },
      "DB error fetching page row — skipping URL",
    );
    return;
  }

  if (!pageRow) return;
  const removed = removedQueuedPageIds.get(scanId);
  if (removed?.has(pageRow.id)) {
    removed.delete(pageRow.id);
    if (removed.size === 0) removedQueuedPageIds.delete(scanId);
    logger.info({ scanId, pageId: pageRow.id, url }, "Skipping URL removed from queue");
    return;
  }
  // Never re-scan a page that is already completed.  This guard applies to all
  // callers; Phase 3 also sets skipCompletedPages: true for an extra layer.
  if (pageRow.status === "completed") return;

  // Atomically claim the row before doing any work. The removal endpoint only
  // deletes rows that remain pending, so this makes "started" a real database
  // boundary rather than relying only on the in-memory queue marker.
  try {
    const claimed = await db
      .update(pageResultsTable)
      .set({ status: "navigating" })
      .where(
        and(
          eq(pageResultsTable.id, pageRow.id),
          inArray(pageResultsTable.status, [
            "pending",
            "failed",
            "requeued",
            "not_available",
          ]),
        ),
      )
      .returning({ id: pageResultsTable.id });
    if (claimed.length === 0) return;
  } catch (err) {
    logger.error(
      { scanId, pageId: pageRow.id, url, err },
      "DB error claiming page row — skipping URL",
    );
    return;
  }

  const queued = queuedRetryUrls.get(scanId);
  if (queued?.has(url)) queued.delete(url);

  const pageId = pageRow.id;

  try {
    // ── Incremental change detection ─────────────────────────────────────
    // A cheap raw-HTML fetch runs for every page so a content hash baseline
    // is always stored. In incremental mode, an unchanged hash lets us carry
    // the previous scan's issues forward and skip the browser entirely.
    let rawHash: string | null = null;
    // Node fetch has no supported PAC/direct-proxy path here. Never silently
    // bypass a proxy that Chromium will use; Chromium remains authoritative.
    const systemProxyPacUrl = await getSystemProxyPacUrl();
    const configuredProxyPacUrl = options.proxyPacUrl || systemProxyPacUrl;
    const staticPreflightPromise = shouldRunStaticPreflight(configuredProxyPacUrl)
      ? runStaticHtmlPreflight(url, { proxyStrategy: "direct" })
      : Promise.resolve(undefined);
    let staticPreflight: StaticHtmlPreflight | undefined;
    if (options.incremental) {
      await setPageStatus(pageId, "checking");
      staticPreflight = await staticPreflightPromise;
      rawHash = staticPreflight?.rawHtmlHash ?? null;
      if (!rawHash && !configuredProxyPacUrl && staticPreflight?.status == null) {
        // WAF-blocked plain fetch (e.g. 403) — retry through a stealth browser
        // with all non-document resources blocked. Still far cheaper than a
        // full scan when the page turns out to be unchanged.
        const body = await fetchRawHtmlViaBrowser(url);
        if (body && classifyStaticHtml(undefined, "text/html", body) === "ok") {
          rawHash = hashRawHtml(body);
        }
      }
      if (rawHash) {
        try {
          if (await tryCarryForward(scanId, pageId, url, rawHash, options, staticPreflight)) {
            return;
          }
        } catch (carryErr) {
          // Carry-forward is an optimization, never the source of a failed
          // page. Reset the claimed row and persist the already-computed fresh
          // browser result below.
          logger.warn({ scanId, pageId, url, err: carryErr }, "Incremental carry-forward failed — scanning fresh result");
          try {
            await db.delete(accessibilityIssuesTable)
              .where(eq(accessibilityIssuesTable.pageId, pageId));
            await db.delete(pageInteractionStatesTable)
              .where(eq(pageInteractionStatesTable.pageId, pageId));
            await db.delete(qaPagesTable)
              .where(and(eq(qaPagesTable.scanId, scanId), inArray(qaPagesTable.url, urlVariants(url))));
            await db.delete(qaLinksTable)
              .where(and(eq(qaLinksTable.scanId, scanId), inArray(qaLinksTable.sourceUrl, urlVariants(url))));
            await db.delete(qaImagesTable)
              .where(and(eq(qaImagesTable.scanId, scanId), inArray(qaImagesTable.sourceUrl, urlVariants(url))));
            await pool.query("DELETE FROM rule_page_stats WHERE page_result_id = $1", [pageId]);
            await pool.query("DELETE FROM rule_execution_statuses WHERE page_result_id = $1", [pageId]);
          } catch (cleanupErr) {
            logger.error({ scanId, pageId, url, err: cleanupErr }, "Incremental carry-forward cleanup failed");
          }
          await db.update(pageResultsTable)
            .set({ status: "pending", carriedForward: false, errorMessage: null })
            .where(eq(pageResultsTable.id, pageId));
        }
      }
    }

    // Stage 1: navigating
    await setPageStatus(pageId, "navigating");
    logger.info({ scanId, url }, "Navigating to page");

    // Hard per-URL deadline covers the scanner's 30s/60s/90s navigation retry
    // sequence, plus post-load scanning and cleanup.
    // When it fires we abort the AbortController, which force-closes the live
    // Puppeteer page so the scan mutex is released immediately.
    // scanDelayMs is the post-DOMContentLoaded dwell time (letting JS execute
    // before checks run).
    const scanDelayMs =
      options.scanDelayMs ?? (await getGlobalScanDelayMs());
    const NAV_TIMEOUT_MS = 30_000;
    const hardDeadline = NAV_TIMEOUT_MS * 6 + scanDelayMs + 60_000;
    const urlAbortController = new AbortController();
    let hardTimer: ReturnType<typeof setTimeout> | null = null;
    const hardTimeoutPromise = new Promise<never>((_, reject) => {
      hardTimer = setTimeout(() => {
        urlAbortController.abort(); // force-closes the Puppeteer page
        reject(
          new Error(
            `URL scan hard-timeout after ${hardDeadline}ms — aborting stuck navigation`,
          ),
        );
      }, hardDeadline);
    });

    // Run scanPage against the hard-deadline.  If the hard timer fires first
    // we convert the thrown error into a synthetic failed result so that the
    // shouldAutoRetry logic below still applies (Phase 2 queue) instead of
    // falling into the outer catch which skips retry altogether.
    // Fetch the raw content hash in parallel with the browser scan so every
    // completed page stores a baseline for future incremental scans.
    const rawHashPromise: Promise<string | null> = rawHash
      ? Promise.resolve(rawHash)
      : staticPreflightPromise.then((preflight) => preflight?.rawHtmlHash ?? null).catch(() => null);
    let result: Awaited<ReturnType<typeof scanPage>>;
    const scanStart = Date.now();
    try {
      result = await Promise.race([
        scanPage(url, {
          timeout: NAV_TIMEOUT_MS,
          scanDelayMs,
          bypassCSP: options.bypassCSP,
          rules: options.rules,
          proxyPacUrl: options.proxyPacUrl,
          // If a system proxy is configured and this scan isn't already using it,
          // pass it as a fallback so 403-blocked pages can automatically retry via proxy.
          fallbackProxyPacUrl: !options.proxyPacUrl && systemProxyPacUrl && !proxyFailedUrls.get(scanId)?.has(url) ? systemProxyPacUrl : undefined,
          disableJavascript: options.disableJavascript,
          signal: urlAbortController.signal,
          staticPreflightPromise,
          onStage: async (stage: string) => {
            await setPageStatus(pageId, stage);
          },
        }),
        hardTimeoutPromise,
      ]);
    } catch (raceErr) {
      // Hard-timeout (or any scanPage internal rejection) — treat as a
      // recoverable failure so the retry queue picks it up.
      result = { url, issues: [], error: String(raceErr) };
    } finally {
      if (hardTimer !== null) clearTimeout(hardTimer);
    }

    // Stage final: saving
    await setPageStatus(pageId, "saving");
    logger.info({ scanId, url }, "Saving scan results");

    const issueCount = result.issues.length;
    const criticalCount = result.issues.filter(
      (i) => i.impact === "critical",
    ).length;

    // Allow up to MAX_AUTO_RETRIES automatic retries per URL per scan run
    if (!autoRetryCounters.has(scanId))
      autoRetryCounters.set(scanId, new Map());
    const counters = autoRetryCounters.get(scanId)!;
    const retryCount = counters.get(url) ?? 0;
    const shouldAutoRetry =
      Boolean(result.error) &&
      !result.notAvailable &&
      activeScanControllers.has(scanId) &&
      retryCount < MAX_AUTO_RETRIES;

    // Track URLs whose proxy fallback failed — future retries won't use the broken proxy
    if (result.error?.includes("[proxy_failure]")) {
      if (!proxyFailedUrls.has(scanId)) proxyFailedUrls.set(scanId, new Set());
      proxyFailedUrls.get(scanId)!.add(url);
    }

    const pageStatus = result.notAvailable
      ? "not_available"
      : result.error
        ? "failed"
        : "completed";

    // When a page is WAF-blocked, generate a short-lived token so the Ampera
    // WAF Scanner extension can authenticate its local scan results.
    if (result.wafBlocked) {
      const token = randomBytes(16).toString("hex");
      const expires = Date.now() + WAF_TOKEN_TTL_MS;
      wafPageTokens.set(pageId, { token, scanId, expires });
      wafTokenIndex.set(token, { pageId, scanId, expires });
      logger.info({ scanId, pageId, url }, "WAF-blocked page — local scan token issued");
    }

    // Update the primary row with full result data
    const scanDurationMs = Date.now() - scanStart;
    const resolvedPreflight =
      staticPreflight ??
      (await staticPreflightPromise.catch(() => undefined));
    const provenance = result.httpProvenance ?? {
      requestedUrl: resolvedPreflight?.requestedUrl ?? url,
      finalUrl: resolvedPreflight?.finalUrl,
      httpStatus: result.httpStatus ?? resolvedPreflight?.status,
      contentType: resolvedPreflight?.contentType,
      responseCapturedAt: resolvedPreflight?.capturedAt ?? new Date(),
      acquisitionMethod: "chromium" as const,
      proxyStrategy: options.proxyPacUrl ? "configured_pac" as const : "direct" as const,
      rawHtmlHash: resolvedPreflight?.rawHtmlHash,
    };
    // A static error/challenge/empty response is never used for incremental
    // eligibility above. Chromium may nevertheless reach the real page (for
    // example through a proxy), so retain its hash as provenance when the
    // authoritative scan completes.
    const completedRawHash =
      pageStatus === "completed"
        ? ((await rawHashPromise.catch(() => null)) ??
          (result.rawHtml
            ? hashRawHtml(result.rawHtml)
            : null))
        : null;
    logger.info(
      { scanId, url, pageId, pageStatus, issueCount, loadDurationMs: result.loadDurationMs ?? null, scanDurationMs },
      "TIMING: writing page result to DB",
    );
    await db
      .update(pageResultsTable)
      .set({
        status: pageStatus,
        issueCount,
        criticalCount,
        errorMessage: result.error || null,
        scannedAt: new Date(),
        loadDurationMs: result.loadDurationMs ?? null,
        scanDurationMs,
        screenshot: result.screenshot ?? null,
        pageHtml: result.pageHtml ?? null,
        // Only store a hash baseline for successfully completed pages —
        // a hash on a failed page could cause a bad carry-forward later.
        // Fall back to the browser's raw navigation response when the plain
        // HTTP fetch was WAF-blocked (e.g. Keysight returns 403 to plain GETs).
        contentHash: completedRawHash,
        finalUrl: provenance.finalUrl ?? null,
        httpStatus: provenance.httpStatus ?? null,
        contentType: provenance.contentType ?? null,
        responseCapturedAt: provenance.responseCapturedAt,
        acquisitionMethod: provenance.acquisitionMethod,
        proxyStrategy: provenance.proxyStrategy,
        rawHtmlHash: completedRawHash,
        renderedDomHash: result.httpProvenance?.renderedDomHash ?? null,
        carriedForward: false,
      })
      .where(eq(pageResultsTable.id, pageId));
    logger.info(
      { scanId, url, pageId },
      "TIMING: DB update complete",
    );

    // Sync any duplicate rows for the same URL so they never stay "pending".
    // Crucially, NEVER overwrite a row that is already "completed" — doing so
    // would cause the DONE counter to drop when a retry of a duplicate row fails.
    await db
      .update(pageResultsTable)
      .set({
        status: pageStatus,
        issueCount: 0,
        criticalCount: 0,
        errorMessage: result.error || null,
        scannedAt: new Date(),
      })
      .where(
        and(
          eq(pageResultsTable.scanId, scanId),
          eq(pageResultsTable.url, url),
          sql`${pageResultsTable.id} != ${pageId}`,
          sql`${pageResultsTable.status} != 'completed'`,
        ),
      );

    logger.info({ scanId, url, pageId, issueCount }, "Inserting issues into DB");
    // Persist one registry decision per rule/page, including failures. This
    // keeps "no finding", "not applicable", and "not selected" distinct.
    try {
      const selected = getSelectedRuleIds(options.rules);
      const statuses = result.ruleStatuses?.length
        ? result.ruleStatuses
        : getRuleExecutionStatuses(selected, new Set());
      await persistRuleStatuses(
        pageId,
        result.error || result.notAvailable
          ? statuses.map((status) => status.status === "not-selected"
            ? status
            : { ...status, status: "failed" as const })
          : statuses,
      );
    } catch (statusErr) {
      logger.warn({ scanId, url, err: statusErr }, "Failed to persist rule execution statuses");
    }
    const interactionStateIds = new Map<string, number>();
    if ((result.interactionStates?.length ?? 0) > 0) {
      const insertedStates = await db
        .insert(pageInteractionStatesTable)
        .values(
          result.interactionStates!.map((state) => ({
            pageId,
            stateKey: state.key,
            triggerSelector: state.triggerSelector,
            triggerLabel: state.triggerLabel,
            screenshot: state.screenshot,
            pageHtml: state.pageHtml,
          })),
        )
        .returning({
          id: pageInteractionStatesTable.id,
          stateKey: pageInteractionStatesTable.stateKey,
        });
      for (const state of insertedStates) {
        interactionStateIds.set(state.stateKey, state.id);
      }
    }
    if (result.issues.length > 0) {
      try {
        const insertedIssues = await db.insert(accessibilityIssuesTable).values(
          result.issues.map((issue) => ({
            pageId,
            ruleId: issue.ruleId,
            ruleType: issue.type ?? "Issue",
            impact: issue.impact,
            description: issue.description,
            element: issue.element,
            elementContext: issue.elementContext ?? null,
            wcagCriteria: issue.wcagCriteria,
            wcagLevel: issue.wcagLevel,
            legalText: getLegalText(issue.legal),
            selector: issue.selector,
            remediation: issue.remediation,
            bboxX: issue.bboxX ?? null,
            bboxY: issue.bboxY ?? null,
            bboxWidth: issue.bboxWidth ?? null,
            bboxHeight: issue.bboxHeight ?? null,
            interactionStateId: issue.interactionStateKey
              ? interactionStateIds.get(issue.interactionStateKey) ?? null
              : null,
          })),
        ).returning({ id: accessibilityIssuesTable.id });
        logger.info({ scanId, url, pageId, issueCount }, "Issues inserted successfully");
        if (shouldQueueAIAssessments(options)) {
          void enqueueIssueAssessments(insertedIssues.map((issue) => issue.id), url, result.pageHtml ?? null)
            .catch((err) => logger.warn({ scanId, url, pageId, err }, "AI assessments could not be queued"));
        }
      } catch (insertErr) {
        logger.error({ scanId, url, pageId, issueCount, err: insertErr }, "ISSUE INSERT FAILED");
        throw insertErr;
      }
    }

    // Save per-rule check counts for true compliance ratio scoring
    if (result.ruleStats && result.ruleStats.length > 0) {
      try {
        const statsValues = result.ruleStats
          .filter((s) => s.totalChecked > 0)
          .map((s) => `(${pageId}, '${s.ruleId.replace(/'/g, "''")}', ${s.totalChecked}, '${s.scope}')`)
          .join(",");
        if (statsValues) {
          await pool.query(
            `INSERT INTO rule_page_stats (page_result_id, rule_id, total_checked, scope)
             VALUES ${statsValues}
             ON CONFLICT (page_result_id, rule_id) DO UPDATE
               SET total_checked = EXCLUDED.total_checked, scope = EXCLUDED.scope`,
          );
        }
      } catch (statsErr) {
        logger.warn({ scanId, url, err: statsErr }, "Failed to insert rule_page_stats — scoring will use proxy");
      }
    }

    // Save QA page metadata
    if (result.pageMeta && pageStatus === "completed") {
      try {
        await db.insert(qaPagesTable).values({
          scanId,
          url,
          title: result.pageMeta.title ?? null,
          h1: result.pageMeta.h1 ?? null,
          metaDescription: result.pageMeta.metaDescription ?? null,
          httpStatus: result.httpStatus ?? null,
          wordCount: result.pageMeta.wordCount ?? null,
          lastModified: result.pageMeta.lastModified ?? null,
          scannedAt: new Date(),
        });
      } catch (qaPageErr) {
        logger.warn({ scanId, url, err: qaPageErr }, "QA: failed to insert qa_pages row");
      }
    }

    // Save extracted links for QA link graph
    if (result.links && result.links.length > 0) {
      try {
        await db.insert(qaLinksTable).values(
          result.links.map((link) => ({
            scanId,
            sourceUrl: url,
            destUrl: link.href,
            anchorText: link.anchorText || null,
            linkType: link.linkType,
          })),
        );
      } catch (qaLinkErr) {
        logger.warn({ scanId, url, err: qaLinkErr }, "QA: failed to insert qa_links rows");
      }
    }

    // Update session totals (skipped during post-cycle retry; recomputed from DB after)
    if (!skipCounterUpdates) {
      const [session] = await db
        .select({
          scannedUrls: scanSessionsTable.scannedUrls,
          failedUrls: scanSessionsTable.failedUrls,
          totalIssues: scanSessionsTable.totalIssues,
          criticalIssues: scanSessionsTable.criticalIssues,
        })
        .from(scanSessionsTable)
        .where(eq(scanSessionsTable.id, scanId));

      if (session) {
        await db
          .update(scanSessionsTable)
          .set({
            scannedUrls:
              result.error && !result.notAvailable
                ? session.scannedUrls
                : session.scannedUrls + 1,
            failedUrls:
              result.error && !result.notAvailable
                ? session.failedUrls + 1
                : session.failedUrls,
            totalIssues: session.totalIssues + issueCount,
            criticalIssues: session.criticalIssues + criticalCount,
          })
          .where(eq(scanSessionsTable.id, scanId));
      }
    }

    // Detect browser-corrupting errors: TargetCloseError means the Chrome
    // DevTools target was destroyed (SPA navigation during rule evaluation,
    // OOM reap, etc.).  Reset the browser instance so the next retry starts
    // with a clean Chrome process instead of inheriting the broken state.
    const errorStr = result.error ?? "";
    const isBrowserCrash =
      errorStr.includes("TargetCloseError") ||
      errorStr.includes("Execution context was destroyed") ||
      errorStr.includes("Target closed") ||
      errorStr.includes("Session closed");
    if (isBrowserCrash) {
      logger.warn(
        { scanId, url, error: errorStr.slice(0, 200) },
        "Browser-corrupting error detected — resetting browser instance before next retry",
      );
      resetBrowserInstance();
    }

    if (shouldAutoRetry) {
      counters.set(url, retryCount + 1);
      // Exponential backoff: 5s, 10s, 15s … before re-queuing so Cloudflare
      // bot detection has time to settle and Chrome can fully restart.
      const backoffMs = (retryCount + 1) * 5_000;
      logger.info(
        { scanId, url, attempt: retryCount + 1, max: MAX_AUTO_RETRIES, backoffMs },
        "Auto-retrying URL after backoff",
      );
      await new Promise((r) => setTimeout(r, backoffMs));
      queueRetryUrl(scanId, url);
    } else if (result.error && !result.notAvailable) {
      logger.info(
        { scanId, url, retryCount },
        "URL exceeded max auto-retries — giving up",
      );
    }
  } catch (err) {
    // An unexpected error (browser crash, DB failure, etc.) must never take
    // down the whole scan — record the page as failed and carry on.
    logger.error(
      { scanId, url, err },
      "Unexpected error scanning page — marking failed and continuing",
    );
    try {
      await db
        .update(pageResultsTable)
        .set({
          status: "failed",
          errorMessage: String(err),
          scannedAt: new Date(),
        })
        .where(eq(pageResultsTable.id, pageId));
      const [session] = await db
        .select({ failedUrls: scanSessionsTable.failedUrls })
        .from(scanSessionsTable)
        .where(eq(scanSessionsTable.id, scanId));
      if (session) {
        await db
          .update(scanSessionsTable)
          .set({ failedUrls: session.failedUrls + 1 })
          .where(eq(scanSessionsTable.id, scanId));
      }
    } catch (dbErr) {
      logger.error(
        { scanId, url, dbErr },
        "Could not persist page failure to DB",
      );
    }
  }

}

export function cancelScan(scanId: number): boolean {
  pausedScans.delete(scanId);
  const controller = activeScanControllers.get(scanId);
  if (controller) {
    controller.abort();
    return true;
  }
  return false;
}

export function pauseScan(scanId: number): boolean {
  pausedScans.add(scanId);
  return true;
}

export function resumeScan(scanId: number): boolean {
  if (!pausedScans.has(scanId)) return false;
  pausedScans.delete(scanId);
  return true;
}

export function isScanActive(scanId: number): boolean {
  return activeScanControllers.has(scanId);
}

export function isScanPaused(scanId: number): boolean {
  return pausedScans.has(scanId);
}

/**
 * Periodic watchdog that detects scans marked "running" in the DB but not
 * present in the in-memory activeScanControllers (which happens when Azure
 * App Service restarts the container mid-scan).
 *
 * For each stuck scan it:
 *   1. Resets any mid-flight page rows (navigating/scanning/saving/…) → pending
 *   2. Re-queues all pending/requeued pages and calls startScan()
 *   3. If no pages remain it marks the session "completed"
 *
 * A 3-minute creation-age guard prevents recovering a scan whose page rows
 * haven't been inserted yet (the retry endpoint can take ~30 s for large scans).
 */
/** Returns true when the error is a PostgreSQL read-only-transaction rejection. */
function isReadOnlyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("read-only transaction") || msg.includes("read only");
}

/**
 * Timestamp until which the watchdog suppresses writes (and log spam) after
 * detecting a read-only database.  0 = not suppressed.
 * Suppression window: 10 minutes, then one more attempt before extending again.
 */
let _watchdogSuspendedUntil = 0;
let scanWatchdogTimer: ReturnType<typeof setInterval> | undefined;

export function startScanWatchdog(intervalMs = 60_000): void {
  if (scanWatchdogTimer) return;
  const MID_FLIGHT = [
    "navigating",
    "scanning",
    "rendering",
    "analyzing",
    "saving",
  ] as const;
  const RESTARTABLE = ["pending", "requeued"] as const;

  scanWatchdogTimer = setInterval(async () => {
    if (scanShutdownRequested) return;
    // If the database is in read-only mode, skip writes entirely and avoid
    // flooding the log.  Re-attempt every 10 minutes in case storage was
    // freed up or the connection was switched to the primary.
    if (Date.now() < _watchdogSuspendedUntil) return;

    try {
      const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);

      const runningSessions = await db
        .select({
          id: scanSessionsTable.id,
          options: scanSessionsTable.options,
        })
        .from(scanSessionsTable)
        .where(
          and(
            inArray(scanSessionsTable.status, ["running", "pending"]),
            lt(scanSessionsTable.createdAt, threeMinutesAgo),
          ),
        );

      for (const session of runningSessions) {
        if (scanShutdownRequested) break;
        if (activeScanControllers.has(session.id)) continue;

        logger.warn(
          { scanId: session.id },
          "Watchdog: detected stuck scan — attempting recovery",
        );

        await db
          .update(pageResultsTable)
          .set({ status: "pending" })
          .where(
            and(
              eq(pageResultsTable.scanId, session.id),
              inArray(pageResultsTable.status, [...MID_FLIGHT]),
            ),
          );

        const remaining = await db
          .select({ url: pageResultsTable.url })
          .from(pageResultsTable)
          .where(
            and(
              eq(pageResultsTable.scanId, session.id),
              inArray(pageResultsTable.status, [...RESTARTABLE]),
            ),
          );

        if (remaining.length === 0) {
          await db
            .update(scanSessionsTable)
            .set({ status: "completed", completedAt: new Date() })
            .where(eq(scanSessionsTable.id, session.id));
          logger.info(
            { scanId: session.id },
            "Watchdog: stuck scan had no remaining pages — marked completed",
          );
          continue;
        }

        const urls = remaining.map((r) => r.url);
        logger.info(
          { scanId: session.id, urlCount: urls.length },
          "Watchdog: restarting stuck scan",
        );
        startScan(session.id, urls, {
          ...((session.options as Record<string, unknown>) ?? {}),
          skipCompletedPages: true,
        }).catch((err) => {
          logger.error(
            { scanId: session.id, err },
            "Watchdog: stuck scan restart failed",
          );
        });
      }
    } catch (err) {
      if (isReadOnlyError(err)) {
        // Suspend the watchdog for 10 minutes to avoid log-flooding.
        // The database is either out of storage (Azure auto-enables read-only
        // at 95% usage) or DATABASE_URL points to a read-replica.
        // Actions: (1) open Azure portal → your PostgreSQL server → Storage →
        //          increase allocated storage or clean up data; OR
        //          (2) verify DATABASE_URL uses the *primary* hostname, not a
        //          *.read.postgres.database.azure.com replica endpoint.
        _watchdogSuspendedUntil = Date.now() + 10 * 60 * 1000;
        logger.fatal(
          { err },
          "DATABASE IS READ-ONLY — all writes are blocked. " +
            "Watchdog suspended for 10 minutes. " +
            "Fix on Azure: (1) Storage ≥ 95%? Increase storage or delete data in the Azure portal. " +
            "(2) DATABASE_URL pointing to a read-replica? Use the primary server hostname.",
        );
      } else {
        logger.error({ err }, "Scan watchdog encountered an error");
      }
    }
  }, intervalMs);
}

/** Stop background scan work during a graceful process shutdown. */
export function stopScanWork(): void {
  scanShutdownRequested = true;
  if (scanWatchdogTimer) {
    clearInterval(scanWatchdogTimer);
    scanWatchdogTimer = undefined;
  }
  for (const controller of activeScanControllers.values()) controller.abort();
}

export function isScanWorkStopping(): boolean {
  return scanShutdownRequested;
}
