import crypto from "crypto";
import { execSync } from "child_process";
import { mkdirSync, existsSync, rmSync } from "fs";
import path from "path";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser } from "puppeteer";
import { db, pool } from "@workspace/db";
import {
  crawlerSessionsTable,
  crawlerPagesTable,
  brokenLinksTable,
  crawlerDiscoveryCacheTable,
  siteContentRulesTable,
  crawlerUrlEventsTable,
  sitesTable,
  scanSessionsTable,
  pageResultsTable,
  accessibilityIssuesTable,
  qaPagesTable,
  qaLinksTable,
  qaImagesTable,
} from "@workspace/db";
import { runCrawlPostProcessing } from "./crawlProcessor";
import { eq, and, inArray, lte, sql } from "drizzle-orm";
import { scanPage, fetchRawHtmlViaBrowser } from "./scanner";
import { fetchSitemapUrls } from "./sitemap";
import { logger } from "./logger";

const crawlerDiscoveryCacheFields = {
  id: crawlerDiscoveryCacheTable.id,
  domain: crawlerDiscoveryCacheTable.domain,
  seedUrl: crawlerDiscoveryCacheTable.seedUrl,
  sourceSessionId: crawlerDiscoveryCacheTable.sourceSessionId,
  urlCount: crawlerDiscoveryCacheTable.urlCount,
  cachedAt: crawlerDiscoveryCacheTable.cachedAt,
};

const crawlerPageFields = {
  id: crawlerPagesTable.id,
  sessionId: crawlerPagesTable.sessionId,
  url: crawlerPagesTable.url,
  urlHash: crawlerPagesTable.urlHash,
  status: crawlerPagesTable.status,
  depth: crawlerPagesTable.depth,
  discoveredFrom: crawlerPagesTable.discoveredFrom,
  contentHash: crawlerPagesTable.contentHash,
  httpStatus: crawlerPagesTable.httpStatus,
  issueCount: crawlerPagesTable.issueCount,
  ruleCount: crawlerPagesTable.ruleCount,
  pageType: crawlerPagesTable.pageType,
  errorMessage: crawlerPagesTable.errorMessage,
  scannedAt: crawlerPagesTable.scannedAt,
  capturedHtml: crawlerPagesTable.capturedHtml,
};

const crawlerSessionFields = {
  id: crawlerSessionsTable.id,
  userId: crawlerSessionsTable.userId,
  name: crawlerSessionsTable.name,
  seedUrl: crawlerSessionsTable.seedUrl,
  status: crawlerSessionsTable.status,
  config: crawlerSessionsTable.config,
  scanSessionId: crawlerSessionsTable.scanSessionId,
  discoveredAt: crawlerSessionsTable.discoveredAt,
};

puppeteerExtra.use(StealthPlugin());

/**
 * Resolve the discovery-profile root without sharing the scanner's live
 * Chromium profile. A separate sibling profile avoids Chrome lock contention
 * during Crawl Boost, while still putting discovery on persistent storage when
 * CHROME_PROFILE_DIR is configured for Azure.
 */
export function getDiscoveryProfileDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env["CRAWLER_PROFILE_DIR"]) return env["CRAWLER_PROFILE_DIR"];
  const scannerProfileDir =
    env["CHROME_PROFILE_DIR"] ??
    path.join(env["HOME"] ?? "/tmp", ".cache", "a11y-chrome-profile");
  return `${scannerProfileDir}-discovery`;
}

const CRAWLER_PROFILE_DIR = getDiscoveryProfileDir();
try { mkdirSync(CRAWLER_PROFILE_DIR, { recursive: true }); } catch { /* exists */ }

const CRAWLER_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--window-size=1440,900",
  "--lang=en-US,en;q=0.9",
  "--disable-blink-features=AutomationControlled",
  "--disable-background-networking",
  "--disable-sync",
  "--no-first-run",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-translate",
  "--mute-audio",
  "--hide-scrollbars",
];

export function getCrawlerProxyLaunchArg(proxyUrl: string): string {
  const parsed = new URL(proxyUrl);
  const directProxy =
    parsed.protocol === "socks4:" ||
    parsed.protocol === "socks5:" ||
    ((parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.port));
  return `${directProxy ? "--proxy-server" : "--proxy-pac-url"}=${proxyUrl}`;
}

function getDiscoveryChromiumPath(): string | undefined {
  if (process.env["PUPPETEER_EXECUTABLE_PATH"]) {
    const p = process.env["PUPPETEER_EXECUTABLE_PATH"];
    if (existsSync(p)) return p;
  }
  try {
    const p = execSync(
      "which chromium-browser 2>/dev/null || which chromium 2>/dev/null || which google-chrome 2>/dev/null || which google-chrome-stable 2>/dev/null",
      { timeout: 3000 },
    ).toString().trim();
    if (p && existsSync(p)) return p;
  } catch { /* not found */ }
  return undefined;
}

async function launchDiscoveryBrowser(workerId: number, proxyPacUrl?: string): Promise<Browser> {
  // Each parallel discovery worker gets its own userDataDir so multiple Chrome
  // instances can run concurrently without hitting "The browser is already
  // running for <userDataDir>".  Worker 1 keeps the legacy unsuffixed path for
  // backward compatibility (preserves any existing Cloudflare clearance cookies).
  const profileDir = workerId <= 1
    ? CRAWLER_PROFILE_DIR
    : `${CRAWLER_PROFILE_DIR}-w${workerId}`;

  try { mkdirSync(profileDir, { recursive: true }); } catch { /* exists */ }

  // Remove stale Chrome singleton/lock files left behind when the server was
  // killed while a crawl was in progress. Without this cleanup, Chrome refuses
  // to launch with "The browser is already running for <userDataDir>".
  for (const lockFile of ["SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort"]) {
    const p = path.join(profileDir, lockFile);
    try { rmSync(p); logger.info({ file: p }, "Removed stale Chrome lock file"); } catch { /* doesn't exist — that's fine */ }
  }

  const executablePath = getDiscoveryChromiumPath();
  logger.info({ executablePath: executablePath ?? "(puppeteer default)", workerId, profileDir }, "Launching discovery browser");
  return puppeteerExtra.launch({
    headless: true,
    executablePath,
    // Per-worker persistent profile so Cloudflare clearance cookies survive
    // across pages within a session (and partly across sessions).
    userDataDir: profileDir,
    args: proxyPacUrl
      ? [...CRAWLER_LAUNCH_ARGS, getCrawlerProxyLaunchArg(proxyPacUrl)]
      : CRAWLER_LAUNCH_ARGS,
    // Discovery also retries slow navigation and evaluates large rendered
    // documents; keep CDP calls from expiring while the page is settling.
    protocolTimeout: 180_000,
  }) as Promise<Browser>;
}

/**
 * A normal crawl stays in "discovering" until Phase 1 finishes. Crawl Boost
 * intentionally changes the shared session to "scanning" before it launches
 * both phases, so its discovery workers must accept that state too.
 */
export function canRunDiscoveryWorker(
  sessionStatus: string | null | undefined,
  crawlBoost: boolean,
): boolean {
  return sessionStatus === "discovering" || (crawlBoost && sessionStatus === "scanning");
}

/** Returns true when the current page looks like a Cloudflare challenge. */
async function isCloudflareChallenge(page: import("puppeteer").Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const title = document.title.toLowerCase();
      const body = document.body?.innerText?.toLowerCase() ?? "";
      return (
        title.includes("just a moment") ||
        title.includes("attention required") ||
        title.includes("checking your browser") ||
        body.includes("verifying you are human") ||
        body.includes("verifying your connection") ||
        body.includes("enable javascript and cookies") ||
        body.includes("just a moment") ||
        (body.includes("cloudflare") && body.length < 3000)
      );
    });
  } catch {
    return false;
  }
}

async function discoverPageLinksWithPuppeteer(
  browser: Browser,
  url: string,
  signal?: AbortSignal,
  captureHtml?: boolean,
): Promise<{ links: Array<{ url: string; text: string }>; httpStatus: number; capturedHtml?: string }> {
  if (signal?.aborted) return { links: [], httpStatus: 0 };

  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    await page.setDefaultNavigationTimeout(90_000);

    let httpStatus = 200;
    let resp: Awaited<ReturnType<typeof page.goto>> = null;
    let lastNavigationError: unknown;
    for (const timeoutMs of [30_000, 60_000, 90_000]) {
      try {
        resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        lastNavigationError = undefined;
        break;
      } catch (err) {
        lastNavigationError = err;
        logger.warn({ url, timeoutMs, err: String(err) }, "Discovery navigation timed out — retrying");
      }
    }
    if (lastNavigationError && !resp) {
      logger.warn({ url, err: String(lastNavigationError) }, "Discovery navigation retries exhausted");
    }
    if (resp) httpStatus = resp.status();

    // Wait for JS frameworks to finish rendering links (MutationObserver, capped at 4 s)
    await page.evaluate(() => new Promise<void>((resolve) => {
      let quiet: ReturnType<typeof setTimeout> | null = null;
      const cap = setTimeout(() => { observer.disconnect(); resolve(); }, 4000);
      const settle = () => {
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(() => { observer.disconnect(); clearTimeout(cap); resolve(); }, 300);
      };
      const target = document.body ?? document.documentElement;
      const observer = new MutationObserver(settle);
      observer.observe(target, { childList: true, subtree: true });
      settle(); // start the initial 300 ms quiet timer
    })).catch(() => {});

    if (signal?.aborted) return { links: [], httpStatus };

    // Cloudflare challenge detection — wait up to 55 s for it to clear
    // (matches the main scanner's challenge budget), then fall back to the
    // scanner's stealth browser pool (whose profile usually holds Cloudflare
    // clearance cookies), and finally to a plain HTTP fetch.
    if (await isCloudflareChallenge(page)) {
      logger.warn({ url }, "Discovery: Cloudflare challenge detected — waiting up to 55 s");
      const deadline = Date.now() + 55_000;
      while (Date.now() < deadline) {
        if (signal?.aborted) return { links: [], httpStatus };
        await new Promise((r) => setTimeout(r, 2000));
        if (!(await isCloudflareChallenge(page))) break;
      }
      if (await isCloudflareChallenge(page)) {
        logger.warn({ url }, "Discovery: Cloudflare challenge not resolved — falling back to scanner browser pool");
        try {
          const rawHtml = await fetchRawHtmlViaBrowser(url);
          if (rawHtml) {
            const links = extractLinks(rawHtml, url);
            logger.info({ url, linkCount: links.length }, "Discovery: scanner-pool fallback extracted links");
            if (links.length > 0) {
              // The scanner-pool browser has Cloudflare clearance cookies, so rawHtml
              // is the real rendered page — pass it as capturedHtml so Phase 2 can
              // use page.setContent() instead of re-navigating and hitting Cloudflare again.
              return { links, httpStatus: 200, ...(captureHtml ? { capturedHtml: rawHtml } : {}) };
            }
          }
        } catch (poolErr) {
          logger.warn({ url, err: String(poolErr) }, "Discovery: scanner-pool fallback failed");
        }
        // Plain fetch can't execute JS challenges, so Cloudflare serves raw HTML
        try {
          const fallback = await discoverPageLinks(url, signal);
          logger.info({ url, linkCount: fallback.links.length }, "Discovery: HTTP fetch fallback extracted links");
          return fallback;
        } catch (fetchErr) {
          logger.warn({ url, err: fetchErr }, "Discovery: HTTP fetch fallback also failed — 0 links");
          return { links: [], httpStatus };
        }
      } else if (httpStatus === 403 || httpStatus === 503) {
        // Challenge cleared — the initial 403/503 belonged to the challenge
        // interstitial, not the real page; treat the settled page as 200.
        // Other statuses (404/500 after clearance) are kept as-is.
        httpStatus = 200;
      }
    }

    const links = await page.evaluate((): Array<{ url: string; text: string }> => {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
      return anchors
        .map((a) => ({
          url: a.href,
          text: (a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
        }))
        .filter((l) => l.url.startsWith("http"));
    });

    if (links.length === 0) {
      logger.warn({ url, httpStatus }, "Discovery: 0 links extracted from page — possible challenge or empty page");
    } else {
      logger.info({ url, linkCount: links.length, httpStatus }, "Discovery: Puppeteer extracted links");
    }

    // Crawl Boost: capture the fully-rendered HTML after stability wait so
    // Phase 2 can reuse it via page.setContent() instead of re-navigating.
    let capturedHtml: string | undefined;
    if (captureHtml) {
      capturedHtml = await page.content().catch(() => undefined);
      if (capturedHtml) {
        logger.info({ url, htmlLen: capturedHtml.length }, "Crawl Boost: captured HTML for Phase 2 reuse");
      }
    }

    return { links, httpStatus, capturedHtml };
  } finally {
    await page.close().catch(() => {});
  }
}

export interface CrawlerConfig {
  seedUrls: string[];
  sitemapUrl?: string;
  maxPages: number;
  maxDepth: number;
  respectRobotsTxt: boolean;
  useSitemap: boolean;
  followLinks: boolean;
  /** @deprecated use crawlScope instead */
  stayOnDomain: boolean;
  /**
   * Controls which discovered URLs are followed:
   * - "all-subdomains": any subdomain of the root domain (blog.x.com matches www.x.com)
   * - "subdomain":      exact subdomain, www-normalised (default when stayOnDomain=true)
   * - "subfolder":      same subdomain + URL path must start with seed path prefix
   * - "exact-url":      no link following; only the seed URL itself is scanned
   */
  crawlScope?: "all-subdomains" | "subdomain" | "subfolder" | "exact-url";
  /** When true, Phase 2 (accessibility scan) starts automatically once discovery finishes. */
  autoScan?: boolean;
  /** When true, only Phase 1 URL discovery runs until a user starts Phase 2. */
  crawlOnly?: boolean;
  blockAssets: boolean;
  tabPoolSize: number;
  scanDelayMs: number;
  authenticated: boolean;
  authUrl?: string;
  authUsernameSelector?: string;
  authPasswordSelector?: string;
  authUsername?: string;
  authPassword?: string;
  authSubmitSelector?: string;
  incremental: boolean;
  prevSessionId?: number;
  detectBrokenLinks: boolean;
  siteId?: number;
  groupId?: number;
  localePattern?: string;
  localePatterns?: string[];
  timezone?: string;
  initiatorName?: string;
  initiatorRole?: string;
  rules?: string[];
  wcagLevels?: string[];
  selectedRules?: string[];
  skipDiscovery?: boolean;
  /**
   * Crawl Boost: when true, Phase 1 captures each page's rendered HTML
   * (with DOM stability wait) and Phase 2 reuses it via page.setContent()
   * instead of re-navigating — eliminates double browser visits and
   * Cloudflare/bot challenges in Phase 2.
   */
  crawlBoost?: boolean;
  /**
   * Number of parallel discovery browsers to use during Phase 1.
   * Each worker claims URLs atomically so there is no double-crawling.
   * Capped at 4 on a single instance; default 2.
   */
  discoveryWorkers?: number;
  /** Optional direct proxy or PAC URL applied to both crawler phases. */
  proxyPacUrl?: string;
  /** Persisted Siteimprove-style URL policy snapshot for this crawl. */
  contentRules?: Array<{
    id?: number;
    ruleType: "include" | "exclude" | "remove_link" | "remove_selector" | string;
    pattern: string;
    patternType?: "contains" | "exact" | "regex" | "glob" | string;
    note?: string | null;
    enabled?: boolean;
  }>;
  assetMode?: "all" | "images_only" | "none" | string;
  /**
   * Page types excluded from this session's accessibility phase. This is
   * snapshotted from the site's current Page Groups choices when Phase 2
   * begins, rather than changing prior scan history when a preference changes.
   */
  excludedPageGroups?: string[];
  /** Marks that Page Group coverage was captured for this Phase 2 run. */
  pageGroupSelectionCapturedAt?: string;
}

const TRACKING_PARAMS = new Set([
  "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
  "fbclid","gclid","msclkid","mc_eid","ref","source","affiliate",
  "_ga","_gl","yclid","zanpid","srsltid","twclid","igshid",
]);

export function normalizeUrl(rawUrl: string, base?: string): string | null {
  try {
    const u = new URL(rawUrl, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return null;
  }
}

export function computeUrlHash(normalizedUrl: string): string {
  return crypto.createHash("sha256").update(normalizedUrl).digest("hex").slice(0, 32);
}

function computeContentHash(html: string): string {
  return crypto.createHash("sha256").update(html).digest("hex").slice(0, 32);
}

// ── Page type classifier ─────────────────────────────────────────────────────
// Segments that are locale/region prefixes and should be skipped before classification.
// Matches 2-3 letter lang codes (en, fr, de, zh) and region codes (us, uk, au),
// and combined locale tags like en-us, zh-cn, pt-br.
const LOCALE_SEG_RE = /^[a-z]{2,3}(-[a-z]{2,4})?$/;

export function classifyPageType(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    let segs = path.split("/").filter(Boolean);
    if (segs.length === 0) return "Home";

    // Skip leading locale/region prefix segments (e.g. /us/en/, /en/, /en-us/)
    let start = 0;
    while (start < segs.length - 1 && LOCALE_SEG_RE.test(segs[start]!)) start++;
    segs = segs.slice(start);

    if (segs.length === 0) return "Home";
    const full = segs.join("/");

    if (/^(about|about-us|about-me|who-we-are|company|our-story|our-team|team|mission|vision|leadership|corporate|overview)/.test(full)) return "About";
    if (/^(event|events|calendar|upcoming|conference|webinar|webinars|seminar|workshop|trade-show|expo|summit|symposium)/.test(full)) return "Events";
    if (/^(news|blog|press|article|articles|insight|insights|post|posts|publication|publications|editorial|stories|media-center|announcements?|newsroom)/.test(full)) return "News & Blog";
    if (/^(product|products|solution|solutions|service|services|offering|offerings|platform|catalog|catalogue|hardware|instrument|instruments|test-equipment|oscilloscope|spectrum|analyzer|analyzers|generator|generators|meter|meters|probe|probes)/.test(full)) return "Products";
    if (/^(software|sw|apps?|application|applications|tool|tools|suite|plugin|plugins|extension|extensions|firmware|driver|drivers)/.test(full)) return "Software";
    if (/^(contact|contact-us|reach-us|get-in-touch|get-a-quote|request-demo|request-a-demo|schedule|quote)/.test(full)) return "Contact";
    if (/^(support|help|faq|knowledge-base|troubleshoot|troubleshooting|how-to|documentation|docs|tutorials?|manual|manuals|kb|key-\d)/.test(full)) return "Support";
    if (/^(learn|learning|tutorial|guide|guides|training|course|courses|education|academy|university|certification|fundamentals?|primer|primers|explore)/.test(full)) return "Learn";
    if (/^(lib|library|resource|resources|download|downloads|asset|assets|whitepaper|whitepapers|datasheet|datasheets|document|documents|technical|literature)/.test(full)) return "Resources";
    if (/^(legal|privacy|privacy-policy|terms|terms-of-service|cookie|disclaimer|compliance|gdpr|accessibility|statement)/.test(full)) return "Legal & Policy";
    if (/^(career|careers|job|jobs|work-with-us|join-us|hiring|vacancies|opportunities|talent)/.test(full)) return "Careers";
    if (/^(gallery|media|video|videos|photo|photos|image|images)/.test(full)) return "Media";
    if (/^(partner|partners|reseller|distributor|ecosystem|alliance|alliances|channel|var|oem)/.test(full)) return "Partners";
    if (/^(search|find|results|query)/.test(full)) return "Search";
    if (/^(location|locations|office|offices|store|stores|dealer|dealers|branch|branches|worldwide|global)/.test(full)) return "Locations";
    if (/^(investor|investors|investor-relations|ir|financials?|annual-report|shareholder|sec)/.test(full)) return "Investors";
    if (/^(industr|industry|industries|vertical|verticals|sector|sectors|market|markets|application|applications|use-case|use-cases|aerospace|automotive|defense|semiconductor|medical|energy|telecom|5g|iot)/.test(full)) return "Industries";
    if (/^(form|forms|other\/forms|cta|checkout|cart|order|purchase|buy|pricing|price)/.test(full)) return "Forms & CTAs";
    if (/^(community|forum|forums|discussion|discussions|developer|developers|dev|api|sdk|sdk-docs)/.test(full)) return "Community & Dev";
    return "General";
  } catch {
    return "General";
  }
}

// ── Robots.txt ───────────────────────────────────────────────────────────────
interface RobotsRules { disallow: string[]; allow: string[]; }
const robotsCache = new Map<string, RobotsRules>();

async function fetchRobotsRules(baseUrl: string): Promise<RobotsRules> {
  try {
    const origin = new URL(baseUrl).origin;
    if (robotsCache.has(origin)) return robotsCache.get(origin)!;
    const res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AccessibilityScanner/1.0)" },
    });
    if (!res.ok) { robotsCache.set(origin, { disallow: [], allow: [] }); return robotsCache.get(origin)!; }
    const text = await res.text();
    const rules: RobotsRules = { disallow: [], allow: [] };
    let inOurAgent = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, "").trim();
      if (!line) { inOurAgent = false; continue; }
      const [field, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (field.toLowerCase() === "user-agent") {
        inOurAgent = value === "*" || value.toLowerCase().includes("accessibilityscanner");
      } else if (inOurAgent) {
        if (field.toLowerCase() === "disallow" && value) rules.disallow.push(value);
        if (field.toLowerCase() === "allow" && value) rules.allow.push(value);
      }
    }
    robotsCache.set(origin, rules);
    return rules;
  } catch { return { disallow: [], allow: [] }; }
}

function isBlockedByRobots(url: string, rules: RobotsRules): boolean {
  let path: string;
  try { path = new URL(url).pathname; } catch { return true; }
  for (const allow of rules.allow) { if (allow && path.startsWith(allow)) return false; }
  for (const disallow of rules.disallow) { if (disallow && path.startsWith(disallow)) return true; }
  return false;
}

// ── Link extraction ──────────────────────────────────────────────────────────
function extractLinks(html: string, base: string): Array<{ url: string; text: string }> {
  const links: Array<{ url: string; text: string }> = [];
  const re = /<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1]?.trim();
    const text = (m[2] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!href) continue;
    const norm = normalizeUrl(href, base);
    if (norm) links.push({ url: norm, text });
  }
  return links;
}

// ── Phase 1: Lightweight HTTP discovery (no Puppeteer) ───────────────────────
async function discoverPageLinks(url: string, signal?: AbortSignal): Promise<{
  links: Array<{ url: string; text: string }>;
  httpStatus: number;
}> {
  const signals: AbortSignal[] = [AbortSignal.timeout(15_000)];
  if (signal) signals.push(signal);
  const combined = AbortSignal.any(signals);

  const res = await fetch(url, {
    signal: combined,
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AccessibilityScanner/1.0)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  const html = await res.text();
  const links = extractLinks(html, url);
  return { links, httpStatus: res.status };
}

// ── Discovery cache ───────────────────────────────────────────────────────────

/** Persist or update the per-domain discovery cache after Phase 1 completes. */
async function saveDiscoveryCache(sessionId: number, domain: string, seedUrl: string): Promise<void> {
  try {
    const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` })
      .from(crawlerPagesTable)
      .where(and(
        eq(crawlerPagesTable.sessionId, sessionId),
        inArray(crawlerPagesTable.status, ["discovered", "completed", "failed", "pending", "skipped", "broken"]),
      ));
    if (cnt === 0) return;
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO crawler_discovery_cache (domain, seed_url, source_session_id, url_count, cached_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (domain) DO UPDATE
           SET seed_url = EXCLUDED.seed_url,
               source_session_id = EXCLUDED.source_session_id,
               url_count = EXCLUDED.url_count,
               cached_at = NOW()`,
        [domain, seedUrl, sessionId, cnt],
      );
    } finally { client.release(); }
    logger.info({ sessionId, domain, urlCount: cnt }, "Discovery cache saved");
  } catch (err) {
    logger.warn({ sessionId, domain, err }, "Failed to save discovery cache — non-fatal");
  }
}

/** Load discovered URLs from a previous session's cache into this session. Returns true if cache was applied. */
async function applyDiscoveryCache(sessionId: number, domain: string, maxPages: number): Promise<boolean> {
  const [cache] = await db.select(crawlerDiscoveryCacheFields)
    .from(crawlerDiscoveryCacheTable)
    .where(eq(crawlerDiscoveryCacheTable.domain, domain))
    .limit(1);

  if (!cache?.sourceSessionId) return false;

  logger.info({ sessionId, domain, sourceSessionId: cache.sourceSessionId, cachedUrls: cache.urlCount }, "Applying discovery cache — skipping Phase 1");

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO crawler_pages (session_id, url, url_hash, status, depth, discovered_from, page_type)
       SELECT $1, url, url_hash, 'discovered', depth, discovered_from, page_type
       FROM crawler_pages
       WHERE session_id = $2
         AND status NOT IN ('broken', 'failed')
       LIMIT $3
       ON CONFLICT DO NOTHING`,
      [sessionId, cache.sourceSessionId, maxPages],
    );
  } finally { client.release(); }

  await updateCrawlerStats(sessionId);
  return true;
}

export async function getDiscoveryCache(domain: string) {
  const [row] = await db.select(crawlerDiscoveryCacheFields)
    .from(crawlerDiscoveryCacheTable)
    .where(eq(crawlerDiscoveryCacheTable.domain, domain))
    .limit(1);
  return row ?? null;
}

export async function clearDiscoveryCache(domain: string): Promise<void> {
  await db.delete(crawlerDiscoveryCacheTable).where(eq(crawlerDiscoveryCacheTable.domain, domain));
}

// ── Active crawlers registry ─────────────────────────────────────────────────
const activeCrawlers = new Map<number, AbortController>();

export function isCrawlerActive(sessionId: number): boolean {
  return activeCrawlers.has(sessionId);
}

export async function pauseCrawlerJob(sessionId: number): Promise<void> {
  await db.update(crawlerSessionsTable)
    .set({ status: "paused", pausedAt: new Date() })
    .where(eq(crawlerSessionsTable.id, sessionId));
  const ctrl = activeCrawlers.get(sessionId);
  if (ctrl) ctrl.abort();
}

export async function cancelCrawlerJob(sessionId: number): Promise<void> {
  await db.update(crawlerSessionsTable)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(crawlerSessionsTable.id, sessionId));
  const ctrl = activeCrawlers.get(sessionId);
  if (ctrl) ctrl.abort();
  activeCrawlers.delete(sessionId);
}

// ── URL enqueue helper ───────────────────────────────────────────────────────

/** Strip leading "www." so that www.example.com and example.com are treated as the same domain. */
function rootDomain(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

type UrlPolicyDecision = {
  allowed: boolean;
  disposition: "included" | "excluded" | "skipped" | "removed";
  reason: string;
  ruleId?: number;
};

function matchesContentRule(url: string, rule: NonNullable<CrawlerConfig["contentRules"]>[number]): boolean {
  const pattern = rule.pattern.trim();
  if (!pattern) return false;
  const type = rule.patternType ?? "contains";
  if (type === "exact") return url === pattern;
  if (type === "contains") return url.includes(pattern);
  if (type === "regex") {
    try { return new RegExp(pattern).test(url); } catch { return false; }
  }
  if (type === "glob") {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*").replace(/\?/g, ".");
    try { return new RegExp(`^${escaped}$`).test(url); } catch { return false; }
  }
  return url.includes(pattern);
}

export function matchesCrawlerPathFilters(
  pathname: string,
  localePatterns?: string[],
  legacyLocalePattern?: string,
): boolean {
  const patterns =
    localePatterns?.length
      ? localePatterns
      : legacyLocalePattern
        ? [legacyLocalePattern]
        : [];
  return patterns.length === 0 || patterns.some((pattern) => pathname.includes(pattern));
}

function evaluateUrlPolicy(
  url: string,
  seedDomain: string,
  seedPath: string,
  robotsRules: RobotsRules | null,
  config: CrawlerConfig,
): UrlPolicyDecision {
  const scope = config.crawlScope ?? (config.stayOnDomain ? "subdomain" : undefined);
  if (scope === "exact-url") {
    return { allowed: false, disposition: "skipped", reason: "Outside exact URL scope" };
  }
  if (scope) {
    try {
      const urlHost = new URL(url).hostname;
      if (scope === "all-subdomains") {
        const root = rootDomain(seedDomain);
        if (urlHost !== root && !urlHost.endsWith("." + root)) {
          return { allowed: false, disposition: "excluded", reason: "Outside all-subdomains scope" };
        }
      } else if (rootDomain(urlHost) !== rootDomain(seedDomain)) {
        return { allowed: false, disposition: "excluded", reason: "Outside site domain scope" };
      } else if (scope === "subfolder" && seedPath && seedPath !== "/" && !new URL(url).pathname.startsWith(seedPath)) {
        return { allowed: false, disposition: "excluded", reason: "Outside seed folder scope" };
      }
    } catch {
      return { allowed: false, disposition: "excluded", reason: "Invalid URL" };
    }
  }
  if (robotsRules && isBlockedByRobots(url, robotsRules)) {
    return { allowed: false, disposition: "skipped", reason: "Blocked by robots.txt" };
  }
  if (config.localePatterns?.length || config.localePattern) {
    try {
      if (!matchesCrawlerPathFilters(new URL(url).pathname, config.localePatterns, config.localePattern)) {
        return { allowed: false, disposition: "skipped", reason: "Outside path filters" };
      }
    } catch {
      return { allowed: false, disposition: "excluded", reason: "Invalid URL" };
    }
  }

  const rules = (config.contentRules ?? []).filter((rule) => rule.enabled !== false);
  const includeRules = rules.filter((rule) => rule.ruleType === "include");
  const excludeRules = rules.filter((rule) => rule.ruleType === "exclude" || rule.ruleType === "remove_link");
  if (includeRules.length > 0 && !includeRules.some((rule) => matchesContentRule(url, rule))) {
    return { allowed: false, disposition: "excluded", reason: "No include rule matched" };
  }
  const matchingExclude = excludeRules.find((rule) => matchesContentRule(url, rule));
  if (matchingExclude) {
    return {
      allowed: false,
      disposition: matchingExclude.ruleType === "remove_link" ? "removed" : "excluded",
      reason: matchingExclude.note?.trim() || `Matched ${matchingExclude.ruleType} rule`,
      ruleId: matchingExclude.id,
    };
  }
  return {
    allowed: true,
    disposition: "included",
    reason: includeRules.length > 0 ? "Matched include rule" : "Within site scope",
  };
}

async function recordUrlEvent(sessionId: number, url: string, decision: UrlPolicyDecision, sourceUrl?: string): Promise<void> {
  try {
    await db.insert(crawlerUrlEventsTable).values({
      sessionId,
      url,
      disposition: decision.disposition,
      reason: decision.reason,
      sourceUrl: sourceUrl ?? null,
      ruleId: decision.ruleId ?? null,
    });
  } catch (err) {
    logger.debug({ sessionId, url, err }, "Failed to persist crawler URL disposition");
  }
}

function shouldEnqueue(
  url: string,
  seedDomain: string,
  seedPath: string,
  robotsRules: RobotsRules | null,
  config: CrawlerConfig,
): boolean {
  return evaluateUrlPolicy(url, seedDomain, seedPath, robotsRules, config).allowed;
}

// ── Phase 1 — Discovery helpers ──────────────────────────────────────────────

/**
 * Atomically claim one pending discovery page using SELECT … FOR UPDATE SKIP
 * LOCKED inside a transaction. Multiple workers calling this concurrently each
 * get a different row; no URL is visited twice.  Returns null when the queue
 * is empty or every remaining pending row is already held by another worker.
 */
async function claimNextPendingPage(sessionId: number) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select(crawlerPageFields)
      .from(crawlerPagesTable)
      .where(and(eq(crawlerPagesTable.sessionId, sessionId), eq(crawlerPagesTable.status, "pending")))
      .orderBy(crawlerPagesTable.id)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    // Mark as claimed so other workers skip it immediately.
    await tx.update(crawlerPagesTable)
      .set({ status: "navigating" })
      .where(eq(crawlerPagesTable.id, row.id));
    return row;
  });
}

// ── Phase 1 — Single discovery worker (one Chromium per worker) ──────────────
async function runDiscoveryWorker(
  workerId: number,
  sessionId: number,
  config: CrawlerConfig,
  seedDomain: string,
  seedPath: string,
  robotsRules: RobotsRules | null,
  seenHashes: Set<string>,
  controller: AbortController,
): Promise<void> {
  let discoveryBrowser: Browser | null = null;
  try {
    discoveryBrowser = await launchDiscoveryBrowser(workerId, config.proxyPacUrl);
    logger.info({ sessionId, workerId }, "Discovery worker started");

    while (!controller.signal.aborted) {
      const [current] = await db.select({ status: crawlerSessionsTable.status })
        .from(crawlerSessionsTable).where(eq(crawlerSessionsTable.id, sessionId)).limit(1);
      if (!canRunDiscoveryWorker(current?.status, !!config.crawlBoost)) {
        logger.info(
          { sessionId, workerId, status: current?.status ?? null, crawlBoost: !!config.crawlBoost },
          "Discovery worker stopped — session is no longer accepting Phase 1 work",
        );
        break;
      }

      // Atomically claim the next pending URL — no two workers visit the same page.
      const pendingPage = await claimNextPendingPage(sessionId);
      if (!pendingPage) {
        logger.info({ sessionId, workerId }, "Discovery worker queue drained");
        break;
      }

      // Depth check — skip over-depth pages and continue to the next URL so
      // other valid pending pages at shallower depths are not abandoned.
      if (pendingPage.depth > config.maxDepth) {
        await db.update(crawlerPagesTable)
          .set({ status: "skipped", scannedAt: new Date(), errorMessage: "Max depth exceeded" })
          .where(eq(crawlerPagesTable.id, pendingPage.id));
        await recordUrlEvent(sessionId, pendingPage.url, {
          allowed: false,
          disposition: "skipped",
          reason: "Maximum crawl depth exceeded",
        }, pendingPage.discoveredFrom ?? undefined);
        await updateCrawlerStats(sessionId);
        continue;
      }

      const pageType = classifyPageType(pendingPage.url);

      try {
        const { links, httpStatus, capturedHtml } = await discoverPageLinksWithPuppeteer(
          discoveryBrowser,
          pendingPage.url,
          controller.signal,
          config.crawlBoost,
        );
        if (controller.signal.aborted) break;

        // A final 4xx/5xx response is a broken destination. Successful
        // redirects are followed by the browser/fetch and are not broken.
        if (httpStatus >= 400 && httpStatus !== 403) {
          logger.info({ sessionId, workerId, url: pendingPage.url, httpStatus }, "Discovery: broken page detected");
          await db.insert(brokenLinksTable).values({
            sessionId,
            sourceUrl: pendingPage.discoveredFrom ?? pendingPage.url,
            brokenUrl: pendingPage.url,
            httpStatus,
            errorType: "http_error",
            anchorText: null,
          });
          await db.update(crawlerPagesTable).set({
            status: "broken",
            pageType,
            httpStatus,
            errorMessage: `HTTP ${httpStatus}`,
            scannedAt: new Date(),
          }).where(eq(crawlerPagesTable.id, pendingPage.id));
          await updateCrawlerStats(sessionId);
          continue;
        }

        // Enqueue newly discovered URLs.
        // seenHashes.add() is synchronous and runs before any await, so
        // concurrent workers in the same Node.js event loop cannot both pass
        // the has() check for the same URL — the DB unique constraint is a
        // second safety net via onConflictDoNothing().
        if (config.followLinks) {
          for (const { url: linkUrl } of links) {
            const norm = normalizeUrl(linkUrl, pendingPage.url);
            if (!norm) continue;
            const decision = evaluateUrlPolicy(norm, seedDomain, seedPath, robotsRules, config);
            await recordUrlEvent(sessionId, norm, decision, pendingPage.url);
            if (!decision.allowed) continue;
            const hash = computeUrlHash(norm);
            if (seenHashes.has(hash)) continue;
            seenHashes.add(hash); // synchronous — safe before first await
            const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` })
              .from(crawlerPagesTable).where(eq(crawlerPagesTable.sessionId, sessionId));
            if (cnt >= config.maxPages) continue;
            await db.insert(crawlerPagesTable).values({
              sessionId,
              url: norm,
              urlHash: hash,
              status: "pending",
              depth: pendingPage.depth + 1,
              discoveredFrom: pendingPage.url,
              pageType: classifyPageType(norm),
            }).onConflictDoNothing();
          }
        }

        await db.update(crawlerPagesTable).set({
          status: "discovered",
          pageType,
          httpStatus,
          scannedAt: new Date(),
          ...(capturedHtml ? { capturedHtml } : {}),
        }).where(eq(crawlerPagesTable.id, pendingPage.id));

      } catch (err) {
        if (controller.signal.aborted) break;
        const msg = err instanceof Error ? err.message : String(err);

        const isDnsFailure = msg.includes("ERR_NAME_NOT_RESOLVED") || msg.includes("ENOTFOUND") || msg.includes("EAI_AGAIN");

        const errorType = isDnsFailure
          ? "dns_error"
          : msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("abort")
            ? "timeout"
            : msg.toLowerCase().includes("ssl") || msg.toLowerCase().includes("certificate")
              ? "ssl_error"
              : "network_error";
        logger.info({ sessionId, workerId, url: pendingPage.url, err: msg }, "Discovery: link destination failed");
        await db.insert(brokenLinksTable).values({
          sessionId,
          sourceUrl: pendingPage.discoveredFrom ?? pendingPage.url,
          brokenUrl: pendingPage.url,
          httpStatus: null,
          errorType,
          anchorText: null,
        });
        await db.update(crawlerPagesTable).set({
          status: "broken",
          pageType,
          errorMessage: `Discovery error: ${msg.slice(0, 200)}`,
          scannedAt: new Date(),
        }).where(eq(crawlerPagesTable.id, pendingPage.id));
        await updateCrawlerStats(sessionId);
      }

      await updateCrawlerStats(sessionId);
    }
  } finally {
    if (discoveryBrowser) {
      await discoveryBrowser.close().catch(() => {});
      logger.info({ sessionId, workerId }, "Discovery worker browser closed");
    }
  }
}

// ── Phase 1 — Discovery phase (spawns N parallel workers) ────────────────────
async function runDiscoveryPhase(
  sessionId: number,
  config: CrawlerConfig,
  seedDomain: string,
  seedPath: string,
  robotsRules: RobotsRules | null,
  seenHashes: Set<string>,
  /** When provided (Crawl Boost parallel mode), reuse this controller instead of
   *  creating a new one, and skip managing activeCrawlers here. */
  externalController?: AbortController,
): Promise<void> {
  const controller = externalController ?? new AbortController();
  if (!externalController) activeCrawlers.set(sessionId, controller);

  // Cap at 4 workers on a single instance to stay within RAM budget.
  // Default 2 — conservative enough for a B2-class Azure plan while still
  // halving discovery time compared to a single browser.
  const workerCount = Math.min(4, Math.max(1, config.discoveryWorkers ?? 2));
  logger.info({ sessionId, workerCount }, "Discovery phase starting");

  try {
    await Promise.all(
      Array.from({ length: workerCount }, (_, i) =>
        runDiscoveryWorker(i + 1, sessionId, config, seedDomain, seedPath, robotsRules, seenHashes, controller),
      ),
    );
  } finally {
    if (!externalController && activeCrawlers.get(sessionId) === controller) activeCrawlers.delete(sessionId);
    logger.info({ sessionId, workerCount }, "Discovery phase complete");
  }
}

// ── Phase 2 — Accessibility scan loop ────────────────────────────────────────
async function runScanPhase(
  sessionId: number,
  config: CrawlerConfig,
  scanSessionId: number,
  prevHashes: Map<string, string>,
  seedDomain: string,
  seedPath: string,
  robotsRules: RobotsRules | null,
  /** Crawl Boost parallel mode: keep the scan loop alive while Phase 1 is still
   *  adding pages (poll instead of exiting when the discovered queue is empty). */
  waitForDiscovery = false,
  /** Shared AbortController from the caller (Crawl Boost parallel mode). */
  externalController?: AbortController,
): Promise<void> {
  const controller = externalController ?? new AbortController();
  if (!externalController) activeCrawlers.set(sessionId, controller);

  const allHrefs = new Map<string, { source: string; text: string }>();

  // Seed seenHashes from pages already in DB so Phase 2 doesn't re-enqueue them
  const seenHashes = new Set<string>();
  {
    const existing = await db.select({ urlHash: crawlerPagesTable.urlHash })
      .from(crawlerPagesTable).where(eq(crawlerPagesTable.sessionId, sessionId));
    for (const p of existing) seenHashes.add(p.urlHash);
  }

  // Build sitemap URL set once — used to flag inSitemap on each qa_pages row
  const sitemapUrlSet = new Set<string>();
  if (config.useSitemap) {
    try {
      const [sess] = await db.select({ seedUrl: crawlerSessionsTable.seedUrl })
        .from(crawlerSessionsTable).where(eq(crawlerSessionsTable.id, sessionId)).limit(1);
      const sitemapXml = config.sitemapUrl ?? (sess?.seedUrl ? `${new URL(sess.seedUrl).origin}/sitemap.xml` : null);
      if (sitemapXml) {
        const sitemapUrls = await fetchSitemapUrls(sitemapXml);
        for (const u of sitemapUrls) sitemapUrlSet.add(u);
        logger.info({ sessionId, count: sitemapUrlSet.size }, "Crawler QA: loaded sitemap URLs");
      }
    } catch (err) {
      logger.warn({ sessionId, err }, "Crawler QA: failed to load sitemap URLs — continuing");
    }
  }

  try {
    // Failed page navigations are retried after the normal discovered-page
    // queue drains. This is intentionally separate from the main loop:
    // execution-context destruction can happen after a page has been marked
    // scanning, and those URLs must get another clean browser attempt before
    // the crawler is finalized.
    // Keep this as a single recovery pass. Each failed URL may already have
    // spent up to the full navigation budget, so multiple serial end-of-scan
    // rounds make large crawls appear stuck for many minutes.
    const MAX_END_OF_SCAN_RETRIES = 1;
    let endOfScanRetryRound = 0;

    while (!controller.signal.aborted) {
      const [current] = await db.select({ status: crawlerSessionsTable.status })
        .from(crawlerSessionsTable).where(eq(crawlerSessionsTable.id, sessionId)).limit(1);
      if (!current || current.status !== "scanning") break;

      const [page] = await db.select(crawlerPageFields)
        .from(crawlerPagesTable)
        .where(and(eq(crawlerPagesTable.sessionId, sessionId), eq(crawlerPagesTable.status, "discovered")))
        .orderBy(crawlerPagesTable.id)
        .limit(1);

      if (!page) {
        // Crawl Boost parallel mode: Phase 1 may still be adding pages.
        // Poll until the discovery queue drains before running end-of-scan retries.
        if (waitForDiscovery && !controller.signal.aborted) {
          const [{ pendingCnt }] = await db
            .select({ pendingCnt: sql<number>`count(*)::int` })
            .from(crawlerPagesTable)
            .where(
              and(
                eq(crawlerPagesTable.sessionId, sessionId),
                sql`${crawlerPagesTable.status} IN ('pending', 'navigating')`,
              ),
            );
          if (pendingCnt > 0) {
            // Phase 1 still working — wait briefly and check for new discovered pages
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            continue;
          }
        }

        if (endOfScanRetryRound >= MAX_END_OF_SCAN_RETRIES) break;

        const failedRows = await db.select({ id: crawlerPagesTable.id, url: crawlerPagesTable.url })
          .from(crawlerPagesTable)
          .where(and(
            eq(crawlerPagesTable.sessionId, sessionId),
            eq(crawlerPagesTable.status, "failed"),
          ))
          .orderBy(crawlerPagesTable.id);

        if (failedRows.length === 0) break;

        endOfScanRetryRound++;
        logger.warn(
          {
            sessionId,
            round: endOfScanRetryRound,
            max: MAX_END_OF_SCAN_RETRIES,
            count: failedRows.length,
          },
          "Crawler: retrying failed URLs at end of scan",
        );

        await db.update(crawlerPagesTable)
          .set({
            status: "discovered",
            errorMessage: null,
            scannedAt: null,
          })
          .where(and(
            eq(crawlerPagesTable.sessionId, sessionId),
            eq(crawlerPagesTable.status, "failed"),
          ));

        // Give Chrome/WAF state a short recovery window without blocking the
        // crawl for another long interval.
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        continue;
      }

      // Mark as scanning
      await db.update(crawlerPagesTable)
        .set({ status: "scanning" })
        .where(eq(crawlerPagesTable.id, page.id));

      try {
        const scanResult = await scanPage(page.url, {
          timeout: 30_000,
          scanDelayMs: config.scanDelayMs,
          rules: config.rules,
          proxyPacUrl: config.proxyPacUrl,
          signal: controller.signal,
          onStage: undefined,
          // Crawl Boost: reuse HTML captured in Phase 1 to skip re-navigation
          ...(config.crawlBoost && page.capturedHtml ? { preloadHtml: page.capturedHtml } : {}),
        });

        if (controller.signal.aborted) break;

        const contentHash = scanResult.pageHtml ? computeContentHash(scanResult.pageHtml) : "";

        // Incremental: skip if content unchanged
        if (config.incremental && contentHash && prevHashes.get(page.urlHash) === contentHash) {
          await db.update(crawlerPagesTable)
            .set({ status: "skipped", scannedAt: new Date(), contentHash, errorMessage: "Unchanged since last scan" })
            .where(eq(crawlerPagesTable.id, page.id));
          await updateCrawlerStats(sessionId);
          continue;
        }

        // Extract links from Puppeteer-rendered HTML — used for two purposes:
        // 1. Broken link detection (if enabled)
        // 2. Phase-2 discovery: enqueue new pages found during scanning so that
        //    a crawl which got 0 links in Phase 1 (bot-blocked) still discovers pages.
        if (scanResult.pageHtml) {
          const links = extractLinks(scanResult.pageHtml, page.url);

          // 1. Broken link detection
          if (config.detectBrokenLinks) {
            for (const { url: linkUrl, text } of links) {
              if (!allHrefs.has(linkUrl)) allHrefs.set(linkUrl, { source: page.url, text });
            }
          }

          // 2. Discover and enqueue new pages found during Phase 2
          if (config.followLinks) {
            const [{ totalCnt }] = await db.select({ totalCnt: sql<number>`count(*)::int` })
              .from(crawlerPagesTable).where(eq(crawlerPagesTable.sessionId, sessionId));
            let remaining = config.maxPages - totalCnt;
            for (const { url: linkUrl } of links) {
              if (remaining <= 0) break;
              const norm = normalizeUrl(linkUrl, page.url);
              if (!norm) continue;
              if (!shouldEnqueue(norm, seedDomain, seedPath, robotsRules, config)) continue;
              const hash = computeUrlHash(norm);
              if (seenHashes.has(hash)) continue;
              seenHashes.add(hash);
              remaining--;
              const pageType = classifyPageType(norm);
              const isExcluded = (config.excludedPageGroups ?? []).includes(pageType);
              await db.insert(crawlerPagesTable).values({
                sessionId,
                url: norm,
                urlHash: hash,
                status: isExcluded ? "skipped" : "discovered",
                depth: page.depth + 1,
                discoveredFrom: page.url,
                pageType,
                errorMessage: isExcluded ? "Excluded from accessibility scan by Page Group setting" : null,
              }).onConflictDoNothing();
            }
          }
        }

        // Store accessibility results
        // issueCount: total individual occurrences (used by session-level "Occurrences" summary)
        // ruleCount: distinct rules with ≥1 occurrence (shown in the per-page "Rules" badge)
        const issueCount = scanResult.issues?.length ?? 0;
        const ruleCount = scanResult.issues
          ? new Set(scanResult.issues.map((i) => i.ruleId)).size
          : 0;
        let pageResultId: number | undefined;

        const [pr] = await db.insert(pageResultsTable).values({
          scanId: scanSessionId,
          url: page.url,
          status: scanResult.error ? "failed" : "completed",
          issueCount,
          criticalCount: scanResult.issues?.filter((i) => i.impact === "critical").length ?? 0,
          errorMessage: scanResult.error ?? null,
          scannedAt: new Date(),
          loadDurationMs: scanResult.loadDurationMs ?? null,
          screenshot: scanResult.screenshot ?? null,
          pageHtml: scanResult.pageHtml ?? null,
        }).returning({ id: pageResultsTable.id });
        pageResultId = pr?.id;

        if (pageResultId && issueCount > 0) {
          const client = await pool.connect();
          try {
            for (const issue of scanResult.issues ?? []) {
              await client.query(
                `INSERT INTO accessibility_issues
                 (page_id, rule_id, rule_type, impact, description, element, element_context, wcag_criteria, wcag_level, legal_text, selector, remediation, bbox_x, bbox_y, bbox_width, bbox_height)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
                [
                  pageResultId, issue.ruleId, issue.type ?? "Issue", issue.impact, issue.description,
                  issue.element ?? null, issue.elementContext ?? null,
                  issue.wcagCriteria ?? null, issue.wcagLevel ?? null, null,
                  issue.selector ?? null, issue.remediation ?? null,
                  issue.bboxX ?? null, issue.bboxY ?? null, issue.bboxWidth ?? null, issue.bboxHeight ?? null,
                ],
              );
            }
          } finally { client.release(); }
        }

        await db.update(crawlerPagesTable).set({
          status: scanResult.error ? "failed" : "completed",
          contentHash: contentHash || null,
          httpStatus: scanResult.error ? null : 200,
          issueCount,
          ruleCount,
          errorMessage: scanResult.error ?? null,
          scannedAt: new Date(),
        }).where(eq(crawlerPagesTable.id, page.id));

        // Save QA data for this page (crawler pipeline only)
        if (!scanResult.error) {
          try {
            await db.insert(qaPagesTable).values({
              scanId: scanSessionId,
              url: page.url,
              title: scanResult.pageMeta?.title ?? null,
              h1: scanResult.pageMeta?.h1 ?? null,
              metaDescription: scanResult.pageMeta?.metaDescription ?? null,
              httpStatus: scanResult.httpStatus ?? null,
              wordCount: scanResult.pageMeta?.wordCount ?? null,
              bodyText: scanResult.pageMeta?.bodyText ?? null,
              lastModified: scanResult.pageMeta?.lastModified ?? null,
              inSitemap: sitemapUrlSet.has(page.url),
            });
          } catch (qaErr) {
            logger.warn({ sessionId, url: page.url, err: qaErr }, "Crawler QA: failed to insert qa_pages");
          }

          if (scanResult.links && scanResult.links.length > 0) {
            const sourceIsHttps = page.url.startsWith("https://");
            try {
              await db.insert(qaLinksTable).values(
                scanResult.links.map((link) => ({
                  scanId: scanSessionId,
                  sourceUrl: page.url,
                  destUrl: link.href,
                  anchorText: link.anchorText || null,
                  linkType: link.linkType,
                  isUnsafe: sourceIsHttps && link.href.startsWith("http://"),
                })),
              );
            } catch (qaErr) {
              logger.warn({ sessionId, url: page.url, err: qaErr }, "Crawler QA: failed to insert qa_links");
            }
          }

          if (scanResult.images && scanResult.images.length > 0) {
            try {
              await db.insert(qaImagesTable).values(
                scanResult.images.map((img) => ({
                  scanId: scanSessionId,
                  sourceUrl: page.url,
                  src: img.src,
                  alt: img.alt || null,
                  width: img.width ?? null,
                  height: img.height ?? null,
                  isExternal: img.isExternal ?? false,
                })),
              );
            } catch (qaErr) {
              logger.warn({ sessionId, url: page.url, err: qaErr }, "Crawler QA: failed to insert qa_images");
            }
          }
        }

      } catch (err) {
        if (controller.signal.aborted) break;
        const msg = err instanceof Error ? err.message : String(err);
        await db.update(crawlerPagesTable)
          .set({ status: "failed", errorMessage: msg, scannedAt: new Date() })
          .where(eq(crawlerPagesTable.id, page.id));
      }

      await updateCrawlerStats(sessionId);
    }

    if (!controller.signal.aborted) {
      // Broken link detection
      if (config.detectBrokenLinks && allHrefs.size > 0) {
        await checkBrokenLinks(sessionId, allHrefs);
        await updateCrawlerStats(sessionId);
      }

      // Finalize scan_session
      const [stats] = await db.select({
        totalUrls: sql<number>`count(*)::int`,
        totalIssues: sql<number>`sum(issue_count)::int`,
      }).from(pageResultsTable).where(eq(pageResultsTable.scanId, scanSessionId));

      await db.update(scanSessionsTable).set({
        status: "completed",
        completedAt: new Date(),
        totalUrls: stats?.totalUrls ?? 0,
        scannedUrls: stats?.totalUrls ?? 0,
        totalIssues: stats?.totalIssues ?? 0,
      }).where(eq(scanSessionsTable.id, scanSessionId));

      // Finalize crawler session
      const [curr] = await db.select({ status: crawlerSessionsTable.status })
        .from(crawlerSessionsTable).where(eq(crawlerSessionsTable.id, sessionId)).limit(1);
      if (curr?.status === "scanning") {
        await db.update(crawlerSessionsTable)
          .set({ status: "completed", lifecycleStatus: "processing", completedAt: new Date() })
          .where(eq(crawlerSessionsTable.id, sessionId));
      }

      // Keep the lifecycle honest: the crawler is not complete until QA
      // post-processing has finished. This also gives the site overview a
      // useful "processing" state for large crawls.
      await runCrawlPostProcessing(scanSessionId).catch((err) =>
        logger.error({ sessionId, scanSessionId, err }, "Crawler QA post-processing error"),
      );
      await db.update(crawlerSessionsTable)
        .set({ lifecycleStatus: "completed" })
        .where(eq(crawlerSessionsTable.id, sessionId));
      const [managedSession] = await db.select({ siteId: crawlerSessionsTable.siteId })
        .from(crawlerSessionsTable)
        .where(eq(crawlerSessionsTable.id, sessionId))
        .limit(1);
      if (managedSession?.siteId) {
        await db.update(sitesTable).set({
          lifecycleStatus: "idle",
          lastCompletedAt: new Date(),
          nextCrawlAt: sql`CASE WHEN schedule_enabled THEN NOW() + (schedule_interval_days * INTERVAL '1 day') ELSE NULL END`,
          updatedAt: new Date(),
        }).where(eq(sitesTable.id, managedSession.siteId));
      }
    }
  } finally {
    if (!externalController && activeCrawlers.get(sessionId) === controller) activeCrawlers.delete(sessionId);
  }
}

// ── Public: start crawler ─────────────────────────────────────────────────────
export async function startCrawlerJob(sessionId: number): Promise<void> {
  const [session] = await db.select(crawlerSessionFields)
    .from(crawlerSessionsTable)
    .where(eq(crawlerSessionsTable.id, sessionId))
    .limit(1);

  if (!session) { logger.error({ sessionId }, "Crawler session not found"); return; }
  // A pause can arrive immediately after the session is inserted, before the
  // background job gets its first turn. Do not let that delayed start
  // overwrite the user's paused state.
  if (session.status !== "pending" && session.status !== "starting") {
    logger.info({ sessionId, status: session.status }, "Crawler start skipped — session is no longer queued");
    return;
  }

  const config = session.config as CrawlerConfig;

  try {
    await db.update(crawlerSessionsTable)
      .set({ status: "discovering", startedAt: new Date() })
      .where(eq(crawlerSessionsTable.id, sessionId));

    // Create the linked scan session up front for normal crawls. Crawl-only
    // sessions intentionally defer this until the user starts Phase 2.
    let scanSessionId = session.scanSessionId;
    if (!scanSessionId && !config.crawlOnly) {
      const [scanSession] = await db.insert(scanSessionsTable).values({
        userId: session.userId,
        name: `[Crawler] ${session.name}`,
        initiatorName: config.initiatorName ?? null,
        initiatorRole: config.initiatorRole ?? null,
        status: "running",
        groupId: config.groupId ?? null,
        options: { crawlerSessionId: sessionId, source: "crawler", crawlBoost: !!config.crawlBoost } as any,
      }).returning({ id: scanSessionsTable.id });
      scanSessionId = scanSession.id;
      await db.update(crawlerSessionsTable)
        .set({ scanSessionId })
        .where(eq(crawlerSessionsTable.id, sessionId));
    }

    const seedDomain = (() => {
      try { return new URL(session.seedUrl).hostname; } catch { return ""; }
    })();
    const seedPath = (() => {
      try {
        const p = new URL(session.seedUrl).pathname;
        if (p.endsWith("/")) return p;
        const last = p.lastIndexOf("/");
        return last >= 0 ? p.substring(0, last + 1) : "/";
      } catch { return "/"; }
    })();

    const robotsRules = config.respectRobotsTxt ? await fetchRobotsRules(session.seedUrl) : null;

    // Load previous hashes for incremental
    const prevHashes = new Map<string, string>();
    if (config.incremental && config.prevSessionId) {
      const prevPages = await db.select({ urlHash: crawlerPagesTable.urlHash, contentHash: crawlerPagesTable.contentHash })
        .from(crawlerPagesTable)
        .where(and(
          eq(crawlerPagesTable.sessionId, config.prevSessionId),
          eq(crawlerPagesTable.status, "completed"),
          sql`${crawlerPagesTable.errorMessage} IS NULL`,
        ));
      for (const p of prevPages) { if (p.contentHash) prevHashes.set(p.urlHash, p.contentHash); }
    }

    // Build initial URL queue
    const seenHashes = new Set<string>();
    const urlQueue: Array<{ url: string; urlHash: string; depth: number; discoveredFrom: string | null }> = [];

    const enqueueInitial = (url: string, depth: number, from: string | null, skipLocale = false) => {
      const norm = normalizeUrl(url, session.seedUrl);
      if (!norm) return;
      // For explicit seed URLs, bypass locale filter — user chose them intentionally.
      // Locale filter applies only to links discovered during crawl.
      const checkConfig = skipLocale
        ? { ...config, localePattern: undefined, localePatterns: undefined }
        : config;
      const decision = evaluateUrlPolicy(norm, seedDomain, seedPath, robotsRules, checkConfig);
      void recordUrlEvent(sessionId, norm, decision, from ?? undefined);
      if (!decision.allowed) return;
      const hash = computeUrlHash(norm);
      if (seenHashes.has(hash)) return;
      if (urlQueue.length >= config.maxPages) return;
      seenHashes.add(hash);
      urlQueue.push({ url: norm, urlHash: hash, depth, discoveredFrom: from });
    };

    for (const seed of config.seedUrls) enqueueInitial(seed, 0, null, true);

    if (config.useSitemap) {
      const sitemapUrl = config.sitemapUrl ?? `${new URL(session.seedUrl).origin}/sitemap.xml`;
      try {
        const sitemapUrls = await fetchSitemapUrls(sitemapUrl);
        for (const u of sitemapUrls) enqueueInitial(u, 0, sitemapUrl);
        logger.info({ sessionId, count: sitemapUrls.length }, "Sitemap URLs discovered");
      } catch (err) {
        logger.warn({ sessionId, err }, "Sitemap fetch failed");
      }
    }

    // Insert initial batch
    if (urlQueue.length > 0) {
      const client = await pool.connect();
      try {
        for (const entry of urlQueue) {
          await client.query(
            `INSERT INTO crawler_pages (session_id, url, url_hash, status, depth, discovered_from, page_type)
             VALUES ($1, $2, $3, 'pending', $4, $5, $6)
             ON CONFLICT (session_id, url_hash) DO NOTHING`,
            [sessionId, entry.url, entry.urlHash, entry.depth, entry.discoveredFrom, classifyPageType(entry.url)],
          );
        }
      } finally { client.release(); }
    }

    await updateCrawlerStats(sessionId);

    // ── Phase 1: Discovery (or load from cache) ─────────────────────────────
    if (config.skipDiscovery) {
      const applied = await applyDiscoveryCache(sessionId, seedDomain, config.maxPages);
      if (applied) {
        await db.update(crawlerSessionsTable)
          .set({ status: "crawled", discoveredAt: new Date() })
          .where(eq(crawlerSessionsTable.id, sessionId));
        activeCrawlers.delete(sessionId);
        logger.info({ sessionId }, "Phase 1 skipped — URL cache applied, awaiting scan trigger");
        return;
      }
      logger.warn({ sessionId, domain: seedDomain }, "skipDiscovery set but no cache found — running Phase 1");
    }

    // ── Crawl Boost: run Phase 1 and Phase 2 truly in parallel ───────────────
    // When crawlBoost is enabled, start accessibility scanning as pages are
    // discovered instead of waiting for all of Phase 1 to finish first.
    if (config.crawlBoost && config.autoScan && !config.crawlOnly && !config.skipDiscovery) {
      logger.info({ sessionId }, "Crawl Boost: starting Phase 1 + Phase 2 in parallel");

      const sharedController = new AbortController();
      activeCrawlers.set(sessionId, sharedController);

      // Jump straight to "scanning" status — Phase 2 loop requires it.
      await db.update(crawlerSessionsTable)
        .set({ status: "scanning", scanStartedAt: new Date() })
        .where(eq(crawlerSessionsTable.id, sessionId));

      try {
        await Promise.all([
          // Phase 1: discover URLs and capture pre-rendered HTML
          runDiscoveryPhase(sessionId, config, seedDomain, seedPath, robotsRules, seenHashes, sharedController),
          // Phase 2: scan discovered pages as they arrive (waitForDiscovery keeps
          // the loop alive while Phase 1 is still adding pages)
          runScanPhase(
            sessionId, config, scanSessionId!, prevHashes,
            seedDomain, seedPath, robotsRules,
            /* waitForDiscovery */ true,
            /* externalController */ sharedController,
          ),
        ]);
      } finally {
        if (activeCrawlers.get(sessionId) === sharedController) activeCrawlers.delete(sessionId);
      }

      // Save discovery cache after both phases complete (for future incremental scans)
      if (!sharedController.signal.aborted) {
        await saveDiscoveryCache(sessionId, seedDomain, session.seedUrl).catch((err) =>
          logger.warn({ sessionId, err }, "Crawl Boost: discovery cache save failed — continuing"),
        );
      }
      return;
    }

    // ── Sequential flow (no Crawl Boost) ────────────────────────────────────
    await runDiscoveryPhase(sessionId, config, seedDomain, seedPath, robotsRules, seenHashes);

    // Check if aborted (paused/cancelled)
    const [afterDisc] = await db.select({ status: crawlerSessionsTable.status })
      .from(crawlerSessionsTable).where(eq(crawlerSessionsTable.id, sessionId)).limit(1);
    if (!afterDisc || afterDisc.status !== "discovering") return;

    // If any pages are still in "navigating" status (a discovery worker crashed
    // mid-navigation without updating the row), mark them broken now.  If left
    // as "navigating", Phase 2 can never pick them up and the session silently
    // "completes" with 0 pages scanned.
    const stuckResult = await db.update(crawlerPagesTable)
      .set({
        status: "broken",
        errorMessage: "Discovery: worker exited before navigation completed",
        scannedAt: new Date(),
      })
      .where(and(
        eq(crawlerPagesTable.sessionId, sessionId),
        eq(crawlerPagesTable.status, "navigating"),
      ));
    const stuckCount = (stuckResult as unknown as { rowCount?: number }).rowCount ?? 0;
    if (stuckCount > 0) {
      logger.warn({ sessionId, stuckCount }, "Phase 1 cleanup: reset stuck 'navigating' pages to 'broken'");
    }

    // Phase 1 complete → save cache then move to "crawled" state.
    await saveDiscoveryCache(sessionId, seedDomain, session.seedUrl);
    await db.update(crawlerSessionsTable)
      .set({ status: "crawled", discoveredAt: new Date() })
      .where(eq(crawlerSessionsTable.id, sessionId));
    activeCrawlers.delete(sessionId);

    if (config.autoScan && !config.crawlOnly) {
      logger.info({ sessionId }, "Phase 1 complete — auto-starting Phase 2 scan");
      await startScanPhase(sessionId);
    } else {
      logger.info({ sessionId }, "Phase 1 complete — awaiting scan trigger");
    }

  } catch (err) {
    logger.error({ sessionId, err }, "Crawler job failed");
    await db.update(crawlerSessionsTable)
      .set({ status: "failed", completedAt: new Date(), errorMessage: err instanceof Error ? err.message : String(err) })
      .where(eq(crawlerSessionsTable.id, sessionId));
    activeCrawlers.delete(sessionId);
  }
}

/**
 * Starts due site schedules. The site row is claimed before the crawler
 * session is inserted so the minute-level scheduler cannot enqueue the same
 * site twice while a previous run is still active.
 */
export async function runScheduledCrawls(): Promise<number> {
  const dueSites = await db.select({
    id: sitesTable.id,
    userId: sitesTable.userId,
    name: sitesTable.name,
    baseUrl: sitesTable.baseUrl,
    defaultScope: sitesTable.defaultScope,
    sitemapUrl: sitesTable.sitemapUrl,
    maxPages: sitesTable.maxPages,
    maxDepth: sitesTable.maxDepth,
    respectRobotsTxt: sitesTable.respectRobotsTxt,
    assetMode: sitesTable.assetMode,
    scheduleIntervalDays: sitesTable.scheduleIntervalDays,
    timezone: sitesTable.timezone,
  })
    .from(sitesTable)
    .where(and(
      eq(sitesTable.scheduleEnabled, true),
      lte(sitesTable.nextCrawlAt, new Date()),
      eq(sitesTable.lifecycleStatus, "idle"),
    ))
    .limit(20);

  let started = 0;
  for (const site of dueSites) {
    const claimed = await db.update(sitesTable)
      .set({
        lifecycleStatus: "crawling",
        nextCrawlAt: sql`NOW() + (${site.scheduleIntervalDays} * INTERVAL '1 day')`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(sitesTable.id, site.id),
        eq(sitesTable.lifecycleStatus, "idle"),
        lte(sitesTable.nextCrawlAt, new Date()),
      ))
      .returning({ id: sitesTable.id });
    if (claimed.length === 0) continue;

    const rules = await db.select({
      id: siteContentRulesTable.id,
      ruleType: siteContentRulesTable.ruleType,
      pattern: siteContentRulesTable.pattern,
      patternType: siteContentRulesTable.patternType,
      note: siteContentRulesTable.note,
      enabled: siteContentRulesTable.enabled,
    })
      .from(siteContentRulesTable)
      .where(and(eq(siteContentRulesTable.siteId, site.id), eq(siteContentRulesTable.enabled, true)))
      .orderBy(siteContentRulesTable.id);
    const config: CrawlerConfig = {
      seedUrls: [site.baseUrl],
      sitemapUrl: site.sitemapUrl ?? undefined,
      maxPages: site.maxPages,
      maxDepth: site.maxDepth,
      respectRobotsTxt: site.respectRobotsTxt,
      useSitemap: true,
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
      siteId: site.id,
      timezone: site.timezone,
      assetMode: site.assetMode,
      contentRules: rules,
    };
    try {
      const [session] = await db.insert(crawlerSessionsTable).values({
        userId: site.userId,
        siteId: site.id,
        name: `${site.name} — scheduled`,
        seedUrl: site.baseUrl,
        status: "pending",
        lifecycleStatus: "queued",
        config,
      }).returning({ id: crawlerSessionsTable.id });
      void startCrawlerJob(session.id).catch((err) =>
        logger.error({ sessionId: session.id, err }, "Scheduled crawler failed to start"),
      );
      started++;
    } catch (err) {
      await db.update(sitesTable)
        .set({ lifecycleStatus: "idle", updatedAt: new Date() })
        .where(eq(sitesTable.id, site.id));
      logger.error({ siteId: site.id, err }, "Scheduled crawler session creation failed");
    }
  }
  return started;
}

/**
 * Starts one-time crawler sessions whose requested start time has arrived.
 * Claiming the row before launching prevents two scheduler ticks from
 * starting the same session.
 */
export async function runDueCrawlerSessions(): Promise<number> {
  const due = await db.update(crawlerSessionsTable)
    .set({ status: "starting", scheduledStartAt: null })
    .where(and(
      eq(crawlerSessionsTable.status, "pending"),
      sql`${crawlerSessionsTable.scheduledStartAt} IS NOT NULL`,
      lte(crawlerSessionsTable.scheduledStartAt, new Date()),
    ))
    .returning({ id: crawlerSessionsTable.id });

  for (const session of due) {
    void startCrawlerJob(session.id).catch((err) =>
      logger.error({ sessionId: session.id, err }, "Scheduled crawler session failed to start"),
    );
  }
  return due.length;
}

// ── Public: resume crawler ────────────────────────────────────────────────────
export async function resumeCrawlerJob(sessionId: number): Promise<void> {
  const [session] = await db.select(crawlerSessionFields)
    .from(crawlerSessionsTable)
    .where(eq(crawlerSessionsTable.id, sessionId))
    .limit(1);

  if (!session || (session.status !== "paused" && session.status !== "failed")) return;

  const config = session.config as CrawlerConfig;
  const seedDomain = (() => { try { return new URL(session.seedUrl).hostname; } catch { return ""; } })();
  const seedPath = (() => {
    try {
      const p = new URL(session.seedUrl).pathname;
      if (p.endsWith("/")) return p;
      const last = p.lastIndexOf("/");
      return last >= 0 ? p.substring(0, last + 1) : "/";
    } catch { return "/"; }
  })();
  const robotsRules = config.respectRobotsTxt ? await fetchRobotsRules(session.seedUrl) : null;

  // Load seen hashes from existing pages
  const seenHashes = new Set<string>();
  const existingPages = await db.select({ urlHash: crawlerPagesTable.urlHash })
    .from(crawlerPagesTable).where(eq(crawlerPagesTable.sessionId, sessionId));
  for (const p of existingPages) seenHashes.add(p.urlHash);

  // Check which phase to run based on pending/discovered pages
  const [{ pendingCnt }] = await db.select({ pendingCnt: sql<number>`count(*)::int` })
    .from(crawlerPagesTable)
    .where(and(eq(crawlerPagesTable.sessionId, sessionId), eq(crawlerPagesTable.status, "pending")));

  const [{ discoveredCnt }] = await db.select({ discoveredCnt: sql<number>`count(*)::int` })
    .from(crawlerPagesTable)
    .where(and(eq(crawlerPagesTable.sessionId, sessionId), eq(crawlerPagesTable.status, "discovered")));

  const prevHashes = new Map<string, string>();
  if (config.incremental && config.prevSessionId) {
    const prevPages = await db.select({ urlHash: crawlerPagesTable.urlHash, contentHash: crawlerPagesTable.contentHash })
      .from(crawlerPagesTable)
      .where(and(
        eq(crawlerPagesTable.sessionId, config.prevSessionId),
        eq(crawlerPagesTable.status, "completed"),
        sql`${crawlerPagesTable.errorMessage} IS NULL`,
      ));
    for (const p of prevPages) { if (p.contentHash) prevHashes.set(p.urlHash, p.contentHash); }
  }

  try {
    if (pendingCnt > 0) {
      // Resume from phase 1. Await the work so the route can report a real
      // launch, and so errors cannot leave the session stuck in discovering.
      await db.update(crawlerSessionsTable)
        .set({ status: "discovering", pausedAt: null, errorMessage: null, completedAt: null })
        .where(eq(crawlerSessionsTable.id, sessionId));

      await runDiscoveryPhase(sessionId, config, seedDomain, seedPath, robotsRules, seenHashes);

      const [afterDisc] = await db.select({ status: crawlerSessionsTable.status })
        .from(crawlerSessionsTable).where(eq(crawlerSessionsTable.id, sessionId)).limit(1);
      if (!afterDisc || afterDisc.status !== "discovering") return;

      await db.update(crawlerSessionsTable)
        .set({ status: "crawled", discoveredAt: new Date() })
        .where(eq(crawlerSessionsTable.id, sessionId));

      if (config.autoScan && !config.crawlOnly) {
        logger.info({ sessionId }, "Phase 1 (resumed) complete — auto-starting Phase 2 scan");
        await startScanPhase(sessionId);
      } else {
        logger.info({ sessionId }, "Phase 1 (resumed) complete — awaiting scan trigger");
      }
      return;
    }

    if (discoveredCnt > 0 && !session.scanSessionId) {
      // Discovery may have finished just before pause was persisted. There is
      // no scan session to resume yet, so restore the normal phase boundary.
      await db.update(crawlerSessionsTable)
        .set({ status: "crawled", discoveredAt: session.discoveredAt ?? new Date(), pausedAt: null, errorMessage: null, completedAt: null })
        .where(eq(crawlerSessionsTable.id, sessionId));
      return;
    }

    if (session.scanSessionId) {
      // A pause can happen after the final discovery row is converted to
      // "discovered", or after the last scan row is claimed. In both cases
      // relying only on discoveredCnt makes Resume a no-op. Re-enter Phase 2
      // whenever the session has a linked scan and is not terminal.
      await db.update(crawlerSessionsTable)
        .set({ status: "crawled", pausedAt: null, errorMessage: null, completedAt: null })
        .where(eq(crawlerSessionsTable.id, sessionId));
      await startScanPhase(sessionId);
      return;
    }

    // A failure before the initial queue or linked scan was created needs a
    // clean Phase 1 restart instead of silently returning from Resume.
    await db.update(crawlerSessionsTable)
      .set({ status: "pending", pausedAt: null, errorMessage: null, completedAt: null })
      .where(eq(crawlerSessionsTable.id, sessionId));
    await startCrawlerJob(sessionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ sessionId, err }, "Crawler resume failed");
    await db.update(crawlerSessionsTable)
      .set({ status: "failed", completedAt: new Date(), errorMessage: message })
      .where(eq(crawlerSessionsTable.id, sessionId));
    throw err;
  }
}

// ── Public: start Phase 2 (accessibility scan) manually ───────────────────────
async function snapshotPageGroupSelection(sessionId: number, config: CrawlerConfig): Promise<CrawlerConfig> {
  // A retry or resume belongs to the same accessibility run. Never replace the
  // coverage it already recorded merely because site preferences changed later.
  if (config.pageGroupSelectionCapturedAt) return config;
  if (!config.siteId) return config;

  const result = await pool.query<{ page_type: string }>(
    `SELECT page_type
     FROM site_page_group_preferences
     WHERE site_id = $1 AND include_in_scan = FALSE`,
    [config.siteId],
  );
  const excludedPageGroups = result.rows.map((row) => row.page_type);
  const snapshot = {
    ...config,
    excludedPageGroups,
    pageGroupSelectionCapturedAt: new Date().toISOString(),
  };

  await db.update(crawlerSessionsTable)
    .set({ config: snapshot })
    .where(eq(crawlerSessionsTable.id, sessionId));
  return snapshot;
}

async function skipExcludedPageGroups(sessionId: number, config: CrawlerConfig): Promise<void> {
  const excludedPageGroups = config.excludedPageGroups ?? [];
  if (excludedPageGroups.length === 0) return;

  const result = await pool.query(
    `UPDATE crawler_pages
     SET status = 'skipped',
         error_message = 'Excluded from accessibility scan by Page Group setting'
     WHERE session_id = $1
       AND status IN ('pending', 'discovered')
       AND COALESCE(page_type, 'General') = ANY($2::text[])`,
    [sessionId, excludedPageGroups],
  );
  if ((result.rowCount ?? 0) > 0) {
    await updateCrawlerStats(sessionId);
    logger.info(
      { sessionId, count: result.rowCount, excludedPageGroups },
      "Excluded Page Groups from accessibility phase",
    );
  }
}

export async function startScanPhase(sessionId: number): Promise<void> {
  const [session] = await db.select(crawlerSessionFields).from(crawlerSessionsTable)
    .where(eq(crawlerSessionsTable.id, sessionId)).limit(1);

  if (!session || session.status !== "crawled") {
    logger.warn({ sessionId, status: session?.status }, "startScanPhase: session not in 'crawled' state");
    return;
  }
  let config = session.config as CrawlerConfig;
  const hadPageGroupSelection = Boolean(config.pageGroupSelectionCapturedAt);
  config = await snapshotPageGroupSelection(sessionId, config);
  await skipExcludedPageGroups(sessionId, config);

  // Crawl-only sessions defer creation of the linked accessibility scan until
  // the user explicitly starts Phase 2 from the crawler details page.
  let scanSessionId = session.scanSessionId;
  if (!scanSessionId) {
    const [scanSession] = await db.insert(scanSessionsTable).values({
      userId: session.userId,
      name: `[Crawler] ${session.name}`,
      initiatorName: config.initiatorName ?? null,
      initiatorRole: config.initiatorRole ?? null,
      status: "running",
      groupId: config.groupId ?? null,
        options: {
          crawlerSessionId: sessionId,
          source: "crawler",
          crawlBoost: !!config.crawlBoost,
          excludedPageGroups: config.excludedPageGroups ?? [],
        } as any,
    }).returning({ id: scanSessionsTable.id });
    scanSessionId = scanSession.id;
    await db.update(crawlerSessionsTable)
      .set({ scanSessionId })
      .where(eq(crawlerSessionsTable.id, sessionId));
  }
  else if (!hadPageGroupSelection) {
    // The auto-scan session is created before discovery. Replace its minimal
    // options with the final Phase 2 snapshot so reports and retries retain
    // the exact Page Group coverage that was used.
    await db.update(scanSessionsTable).set({
      options: {
        crawlerSessionId: sessionId,
        source: "crawler",
        crawlBoost: !!config.crawlBoost,
        excludedPageGroups: config.excludedPageGroups ?? [],
      } as any,
    }).where(eq(scanSessionsTable.id, scanSessionId));
  }

  const prevHashes = new Map<string, string>();
  if (config.incremental && config.prevSessionId) {
    const prevPages = await db.select({ urlHash: crawlerPagesTable.urlHash, contentHash: crawlerPagesTable.contentHash })
      .from(crawlerPagesTable)
      .where(and(
        eq(crawlerPagesTable.sessionId, config.prevSessionId),
        eq(crawlerPagesTable.status, "completed"),
        sql`${crawlerPagesTable.errorMessage} IS NULL`,
      ));
    for (const p of prevPages) { if (p.contentHash) prevHashes.set(p.urlHash, p.contentHash); }
  }

  const seedDomain = (() => { try { return new URL(session.seedUrl).hostname; } catch { return ""; } })();
  const seedPath = (() => {
    try {
      const p = new URL(session.seedUrl).pathname;
      if (p.endsWith("/")) return p;
      const last = p.lastIndexOf("/");
      return last >= 0 ? p.substring(0, last + 1) : "/";
    } catch { return "/"; }
  })();
  const robotsRules = config.respectRobotsTxt ? await fetchRobotsRules(session.seedUrl) : null;

  const abortController = new AbortController();
  activeCrawlers.set(sessionId, abortController);

  await db.update(crawlerSessionsTable)
    .set({ status: "scanning", scanStartedAt: new Date() })
    .where(eq(crawlerSessionsTable.id, sessionId));

  try {
    await runScanPhase(sessionId, config, scanSessionId, prevHashes, seedDomain, seedPath, robotsRules);
  } catch (err) {
    logger.error({ sessionId, err }, "Scan phase (manual trigger) failed");
    await db.update(crawlerSessionsTable)
      .set({ status: "failed", completedAt: new Date(), errorMessage: err instanceof Error ? err.message : String(err) })
      .where(eq(crawlerSessionsTable.id, sessionId));
  } finally {
    activeCrawlers.delete(sessionId);
  }
}

// ── Stats updater ─────────────────────────────────────────────────────────────
async function updateCrawlerStats(sessionId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      UPDATE crawler_sessions SET
        total_discovered = (SELECT count(*) FROM crawler_pages WHERE session_id = $1),
        total_scanned    = (SELECT count(*) FROM crawler_pages WHERE session_id = $1 AND status = 'completed'),
        total_failed     = (SELECT count(*) FROM crawler_pages WHERE session_id = $1 AND status = 'failed'),
        total_skipped    = (SELECT count(*) FROM crawler_pages WHERE session_id = $1 AND status IN ('skipped')),
        total_issues     = COALESCE((
          SELECT sum(issue_count) FROM crawler_pages WHERE session_id = $1 AND status = 'completed'
        ), 0),
        total_rules      = COALESCE((
          SELECT sum(rule_count) FROM crawler_pages WHERE session_id = $1 AND status = 'completed'
        ), 0),
        broken_links_count = (SELECT count(*) FROM broken_links WHERE session_id = $1 AND ((http_status >= 400 AND http_status <> 403) OR http_status IS NULL))
      WHERE id = $1
    `, [sessionId]);
  } finally { client.release(); }
}

// ── Retry failed pages ────────────────────────────────────────────────────────

/**
 * Reset all failed pages to "discovered" and resume scanning if the session was
 * completed/failed. For a still-running session the scan loop picks them up
 * automatically — no restart is needed.
 */
export async function retryFailedPages(sessionId: number): Promise<{ ok: boolean; reset: number }> {
  const [session] = await db.select(crawlerSessionFields)
    .from(crawlerSessionsTable)
    .where(eq(crawlerSessionsTable.id, sessionId))
    .limit(1);

  if (!session) return { ok: false, reset: 0 };

  const failedRows = await db.select({ id: crawlerPagesTable.id })
    .from(crawlerPagesTable)
    .where(and(eq(crawlerPagesTable.sessionId, sessionId), eq(crawlerPagesTable.status, "failed")));

  if (failedRows.length === 0) return { ok: true, reset: 0 };

  await db.update(crawlerPagesTable)
    .set({ status: "discovered", errorMessage: null, scannedAt: null })
    .where(and(eq(crawlerPagesTable.sessionId, sessionId), eq(crawlerPagesTable.status, "failed")));

  await updateCrawlerStats(sessionId);

  // If the session already finished, kick off a new scan phase
  if (["completed", "failed"].includes(session.status) && session.scanSessionId) {
    // startScanPhase requires status = "crawled" before it sets it to "scanning"
    await db.update(crawlerSessionsTable)
      .set({ status: "crawled", completedAt: null, errorMessage: null })
      .where(eq(crawlerSessionsTable.id, sessionId));

    void startScanPhase(sessionId).catch((err) =>
      logger.error({ sessionId, err }, "retryFailedPages: startScanPhase failed"),
    );
  }

  logger.info({ sessionId, reset: failedRows.length }, "retryFailedPages: reset failed pages to discovered");
  return { ok: true, reset: failedRows.length };
}

// ── Broken link detection ─────────────────────────────────────────────────────
async function checkBrokenLinks(
  sessionId: number,
  hrefs: Map<string, { source: string; text: string }>,
): Promise<void> {
  const CONCURRENCY = 10;
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 750;
  const entries = [...hrefs.entries()];
  const checkedUrls = new Set<string>();
  logger.info({ sessionId, total: entries.length }, "Starting broken link detection");

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async ([url, { source, text }]) => {
      if (checkedUrls.has(url)) return;
      checkedUrls.add(url);
      let httpStatus = 0;
      let lastError = "";
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const res = await fetch(url, {
            method: "HEAD",
            signal: AbortSignal.timeout(10_000),
            redirect: "follow",
            headers: { "User-Agent": "Mozilla/5.0 (compatible; AccessibilityScanner/1.0)" },
          });
          httpStatus = res.status;
          if (attempt < MAX_ATTEMPTS && (httpStatus === 408 || httpStatus === 425 || httpStatus === 429 || httpStatus >= 500)) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            continue;
          }
          return;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            continue;
          }
        }
      }
      if (httpStatus >= 400 && httpStatus !== 403) {
        await db.insert(brokenLinksTable).values({
          sessionId,
          sourceUrl: source,
          brokenUrl: url,
          httpStatus,
          errorType: "http_error",
          anchorText: text,
        });
        return;
      }
      const lower = lastError.toLowerCase();
      const errorType = lower.includes("timeout") || lower.includes("abort")
        ? "timeout"
        : lower.includes("ssl") || lower.includes("certificate")
          ? "ssl_error"
          : lower.includes("redirect")
            ? "redirect_error"
            : "network_error";
      if (httpStatus === 0) {
        await db.insert(brokenLinksTable).values({
          sessionId,
          sourceUrl: source,
          brokenUrl: url,
          httpStatus: null,
          errorType,
          anchorText: text,
        });
      }
    }));
  }
}

// ── Startup: auto-resume sessions orphaned by a server restart ─────────────────
/**
 * Called once on server boot.  Finds crawler sessions whose status is
 * "discovering", "crawled", or "scanning" — states that indicate the process
 * died mid-run.  For each orphaned session:
 *
 *  • "discovering" — pages that were mid-scan get reset to "pending" so Phase 1
 *    re-visits them, then the session is set to "paused" and resumeCrawlerJob()
 *    re-starts Phase 1.
 *
 *  • "scanning"    — pages mid-scan get reset to "discovered" so Phase 2
 *    re-processes them, then the session is set to "paused" and
 *    resumeCrawlerJob() re-starts Phase 2.
 *
 *  • "crawled"     — Phase 1 finished but Phase 2 never started; call
 *    startScanPhase() directly.
 *
 * Already-completed pages are preserved in the DB so no work is re-done.
 */
export async function resumeOrphanedCrawlerSessions(): Promise<void> {
  try {
    const orphaned = await db.select({
      id: crawlerSessionsTable.id,
      status: crawlerSessionsTable.status,
      config: crawlerSessionsTable.config,
    })
      .from(crawlerSessionsTable)
      .where(inArray(crawlerSessionsTable.status, ["discovering", "crawled", "scanning"]));

    if (orphaned.length === 0) {
      logger.info("Startup recovery: no orphaned crawler sessions found");
      return;
    }

    logger.info({ count: orphaned.length }, "Startup recovery: found orphaned crawler sessions — resuming");

    for (const session of orphaned) {
      try {
        if (session.status === "discovering") {
          // Phase 1 was in progress: reset any pages that were mid-discovery
          // back to "pending" so workers re-visit them. This includes both
          // "navigating" (atomically claimed by a parallel discovery worker
          // but not yet finished) and "scanning" (legacy status name).
          const result = await db.update(crawlerPagesTable)
            .set({ status: "pending", errorMessage: null, scannedAt: null })
            .where(and(
              eq(crawlerPagesTable.sessionId, session.id),
              inArray(crawlerPagesTable.status, ["navigating", "scanning"]),
            ));

          await db.update(crawlerSessionsTable)
            .set({ status: "paused" })
            .where(eq(crawlerSessionsTable.id, session.id));

          logger.info({ sessionId: session.id, pagesReset: (result as unknown as { rowCount?: number }).rowCount ?? 0 },
            "Startup recovery: resuming Phase 1 (discovery)");

          void resumeCrawlerJob(session.id)
            .catch((err) => logger.error({ sessionId: session.id, err }, "Startup recovery Phase 1 failed"));

        } else if (session.status === "scanning") {
          // Phase 2 was in progress: reset pages stuck mid-scan ("scanning")
          // back to "discovered" so runScanPhase() picks them up again.
          const result = await db.update(crawlerPagesTable)
            .set({ status: "discovered", errorMessage: null, scannedAt: null })
            .where(and(
              eq(crawlerPagesTable.sessionId, session.id),
              eq(crawlerPagesTable.status, "scanning"),
            ));
          const pagesReset = (result as unknown as { rowCount?: number }).rowCount ?? 0;

          // Any "pending" or "navigating" pages are Phase 1 orphans — the
          // discovery phase will NOT run again in this path, so mark them broken
          // now. Without this, resumeCrawlerJob sees pendingCnt > 0 and
          // re-runs Phase 1 discovery instead of Phase 2, causing an infinite
          // restart loop on sites with Cloudflare or slow discovery.
          const orphanResult = await db.update(crawlerPagesTable)
            .set({
              status: "broken",
              errorMessage: "Phase 1 orphan: discovery did not complete before container restart",
              scannedAt: new Date(),
            })
            .where(and(
              eq(crawlerPagesTable.sessionId, session.id),
              inArray(crawlerPagesTable.status, ["pending", "navigating"]),
            ));
          const orphansCleared = (orphanResult as unknown as { rowCount?: number }).rowCount ?? 0;

          // startScanPhase requires the session to be in "crawled" state.
          await db.update(crawlerSessionsTable)
            .set({ status: "crawled" })
            .where(eq(crawlerSessionsTable.id, session.id));

          logger.info({ sessionId: session.id, pagesReset, orphansCleared },
            "Startup recovery: resuming Phase 2 (scanning)");

          // Call startScanPhase directly — NOT resumeCrawlerJob, which would
          // re-run Phase 1 if any "pending" pages exist.
          void startScanPhase(session.id)
            .catch((err) => logger.error({ sessionId: session.id, err }, "Startup recovery Phase 2 failed"));

        } else if (session.status === "crawled" && !(session.config as CrawlerConfig).crawlOnly) {
          // Phase 1 complete, Phase 2 never started — kick it off directly.
          logger.info({ sessionId: session.id }, "Startup recovery: starting Phase 2 from 'crawled' state");

          void startScanPhase(session.id)
            .catch((err) => logger.error({ sessionId: session.id, err }, "Startup recovery Phase 2 (crawled) failed"));
        }

        // Brief stagger so multiple sessions don't slam the browser pool simultaneously.
        await new Promise<void>((r) => setTimeout(r, 1_000));

      } catch (err) {
        logger.error({ sessionId: session.id, err }, "Startup recovery: failed to resume session — skipping");
      }
    }
  } catch (err) {
    logger.error({ err }, "resumeOrphanedCrawlerSessions: unexpected error — orphaned sessions may stay stuck");
  }
}
