import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer";
import { execSync } from "child_process";
import { mkdirSync, rmSync, existsSync, readdirSync } from "fs";
import path from "path";
import os from "os";
import { logger } from "./logger";
import { runPixelContrastPass } from "./pixel-contrast.js";
import {
  hashPreflightHtml,
  hashRenderedDom,
  redactProvenanceUrl,
  runStaticHtmlPreflight,
  shouldRunStaticPreflight,
  type StaticHtmlPreflight,
} from "./httpPreflight.js";
import {
  getSelectedRuleIds,
  hasManualRuleSelected,
  isRuleSelected,
  type RuleExecutionStatus,
} from "./browser/registry";

puppeteerExtra.use(StealthPlugin());

// Replaced by build.mjs in production. The source fallback keeps direct
// development builds compatible with the standalone browser-bundle.js file.
declare const __AMPERA_BROWSER_BUNDLE__: string;

function getChromiumPath(): string | undefined {
  if (process.env["PUPPETEER_EXECUTABLE_PATH"]) {
    const envPath = process.env["PUPPETEER_EXECUTABLE_PATH"];
    // Only use the env var if the binary actually exists at that path.
    // In Azure deployment the env var may point to a Nix store path that
    // does not exist — fall through to other discovery strategies instead.
    if (existsSync(envPath)) return envPath;
    logger.warn(
      { envPath },
      "PUPPETEER_EXECUTABLE_PATH is set but binary not found — searching PATH",
    );
  }

  // Standard PATH lookup — works in dev where Nix adds binaries to PATH.
  // Always verify with existsSync: on some distros `which chromium` returns a
  // stub wrapper at /usr/bin/chromium even when Chromium is not installed.
  try {
    const found = execSync(
      "which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome 2>/dev/null || which google-chrome-stable 2>/dev/null",
    )
      .toString()
      .trim();
    if (found && existsSync(found)) return found;
  } catch {
    /* continue */
  }

  // Resolve symlinks — handles wrapper scripts that `which` returns
  try {
    const resolved = execSync(
      "readlink -f $(which chromium-browser 2>/dev/null || which chromium 2>/dev/null || echo '') 2>/dev/null",
    )
      .toString()
      .trim();
    if (resolved && existsSync(resolved)) return resolved;
  } catch {
    /* continue */
  }

  // Puppeteer-bundled Chrome — present when `puppeteer browsers install chrome`
  // has been run (either in the Docker build or via startup.sh).
  // Check all candidate cache directories in priority order.
  // Checks both chrome-linux64/chrome (current) and chrome-linux/chrome (legacy).
  try {
    const cacheCandidates = [
      process.env["PUPPETEER_CACHE_DIR"],
      path.join(process.cwd(), ".cache", "puppeteer"),
      path.join(os.homedir(), ".cache", "puppeteer"),
      "/app/.cache/puppeteer",
      "/home/site/wwwroot/.cache/puppeteer",
    ].filter(Boolean) as string[];

    for (const cacheDir of cacheCandidates) {
      const chromeDir = path.join(cacheDir, "chrome");
      if (!existsSync(chromeDir)) continue;
      const linuxDirs = readdirSync(chromeDir)
        .filter((d) => d.startsWith("linux-"))
        .sort()
        .reverse(); // highest version first
      for (const dir of linuxDirs) {
        // Newer puppeteer uses chrome-linux64/chrome; older builds use chrome-linux/chrome
        for (const sub of ["chrome-linux64", "chrome-linux"]) {
          const candidate = path.join(chromeDir, dir, sub, "chrome");
          if (existsSync(candidate)) {
            logger.info({ candidate }, "Found Puppeteer-bundled Chrome");
            return candidate;
          }
        }
      }
    }
  } catch {
    /* continue */
  }

  // Nix store scan — covers deployment environments where Nix bin dir is not
  // on PATH but packages are still installed (e.g. Replit Autoscale containers)
  try {
    const nixStore = "/nix/store";
    if (existsSync(nixStore)) {
      const chromiumDirs = readdirSync(nixStore).filter((d) =>
        d.includes("-chromium-"),
      );
      for (const dir of chromiumDirs) {
        for (const bin of ["chromium", "chromium-browser"]) {
          const candidate = path.join(nixStore, dir, "bin", bin);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  } catch {
    /* continue */
  }

  // Azure App Service / Microsoft-hosted environments:
  // Playwright pre-installs Chromium at /ms-playwright/.
  // When getChromiumPath() returns undefined, puppeteer-extra's internal
  // fallback resolves to the same directory but with an incorrect subpath —
  // scan it ourselves so we always return a working executable on Azure.
  try {
    const msDir = "/ms-playwright";
    if (existsSync(msDir)) {
      const chromiumDirs = readdirSync(msDir)
        .filter((d) => /^chromium-/.test(d))
        .sort()
        .reverse(); // highest revision first
      for (const d of chromiumDirs) {
        for (const sub of ["chrome-linux64", "chrome-linux"]) {
          for (const bin of ["chrome", "chromium", "chromium-browser"]) {
            const candidate = path.join(msDir, d, sub, bin);
            if (existsSync(candidate)) {
              logger.info(
                { candidate },
                "Found Azure Playwright pre-installed Chromium",
              );
              return candidate;
            }
          }
        }
      }
    }
  } catch {
    /* continue */
  }

  logger.warn(
    "getChromiumPath: no Chromium binary found in any known location — " +
      "puppeteer will attempt its own internal path resolution which may fail. " +
      "Set PUPPETEER_EXECUTABLE_PATH or run `puppeteer browsers install chrome`.",
  );
  return undefined;
}
export type RuleType =
  | "Issue"
  | "Potential Issue"
  | "Best Practice"
  | "WAI-ARIA";
export interface RuleMeta {
  type: RuleType;
  description: string;
  remediation: string;
  issueDescription?: string;
  potentialDescription?: string;
  deprecated?: boolean;
  deprecatedReason?: string;
  relatedRules?: string[];
}
export interface ScanIssue {
  ruleId: string;
  type: RuleType;
  impact: "critical" | "serious" | "moderate" | "minor";
  description: string;
  element: string | null;
  elementContext?: string | null;
  wcagCriteria: string | null;
  wcagLevel: string | null;
  selector: string | null;
  remediation: string | null;
  legal?: {
    ada: string[];
    eaa: boolean;
  };
  bboxX?: number | null;
  bboxY?: number | null;
  bboxWidth?: number | null;
  bboxHeight?: number | null;
  falsePositive?: boolean;
  /** Local interaction-state key, resolved to a persisted state row by scanQueue. */
  interactionStateKey?: string | null;
}

export interface InteractionStateEvidence {
  key: string;
  triggerSelector: string;
  triggerLabel: string;
  screenshot: string;
  pageHtml: string;
}

export interface QAPageMeta {
  title?: string;
  h1?: string;
  metaDescription?: string;
  wordCount?: number;
  lastModified?: string;
  /** Visible page text — truncated at 10 000 chars; used for word-inventory extraction */
  bodyText?: string;
}

export interface QALink {
  href: string;
  anchorText: string;
  linkType:
    | "internal"
    | "external"
    | "pdf"
    | "document"
    | "javascript"
    | "css"
    | "media"
    | "email"
    | "phone";
}

export interface QAImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  isExternal?: boolean;
}

export interface RuleCheckStat {
  ruleId: string;
  totalChecked: number;
  scope: "element" | "page";
}

export interface PageScanResult {
  url: string;
  issues: ScanIssue[];
  error?: string;
  notAvailable?: boolean;
  /** True when the page returned 403 due to a WAF/firewall IP block (not a content error). */
  wafBlocked?: boolean;
  screenshot?: string;
  pageHtml?: string;
  loadDurationMs?: number;
  /** HTTP status code from page.goto() */
  httpStatus?: number;
  /** Final URL and other sanitized page-level HTTP provenance. */
  httpProvenance?: PageHttpProvenance;
  /** Cheap static preflight classification; never used for accessibility findings. */
  staticPreflight?: StaticHtmlPreflight;
  /** Page metadata extracted for QA analysis */
  pageMeta?: QAPageMeta;
  /** All links extracted from the page for QA link checking */
  links?: QALink[];
  /** All images extracted from the page for QA image inventory */
  images?: QAImage[];
  /** Raw (pre-JavaScript) HTML from the navigation response — used as the
   *  incremental-scan hash baseline when a plain HTTP fetch is WAF-blocked. */
  rawHtml?: string;
  /** Per-rule element/page check counts for true compliance ratio scoring. */
  ruleStats?: RuleCheckStat[];
  /** Optional rule execution details; existing issue/stat contracts are unchanged. */
  ruleStatuses?: RuleExecutionStatus[];
  /** Snapshots of safely revealed dialogs, menus, and disclosure states. */
  interactionStates?: InteractionStateEvidence[];
}

export interface PageHttpProvenance {
  requestedUrl: string;
  finalUrl?: string;
  httpStatus?: number;
  contentType?: string;
  responseCapturedAt: Date;
  acquisitionMethod: "chromium" | "crawler_capture";
  proxyStrategy: "direct" | "configured_pac";
  rawHtmlHash?: string;
  renderedDomHash?: string;
}

export interface PreloadedPageMetadata {
  /** URL after Phase 1 navigation/redirect resolution. */
  finalUrl: string;
  httpStatus: number;
  contentType?: string | null;
  responseCapturedAt: Date;
}

export function createCrawlerCaptureProvenance(
  requestedUrl: string,
  metadata: PreloadedPageMetadata,
): PageHttpProvenance {
  const finalUrl =
    metadata.finalUrl && metadata.finalUrl !== "about:blank"
      ? metadata.finalUrl
      : requestedUrl;
  return {
    requestedUrl: redactProvenanceUrl(requestedUrl),
    finalUrl: redactProvenanceUrl(finalUrl),
    httpStatus: metadata.httpStatus,
    contentType: metadata.contentType ?? undefined,
    responseCapturedAt: metadata.responseCapturedAt,
    acquisitionMethod: "crawler_capture",
    proxyStrategy: "direct",
  };
}

/**
 * Make captured markup safe to parse while giving it the same document base
 * that was used during crawl discovery. Existing base elements intentionally
 * win: sites commonly use them to host assets on a CDN, and replacing one
 * would change the captured page's resource semantics.
 */
export function preparePreloadedHtml(html: string, finalUrl: string): string {
  const escapedUrl = finalUrl
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const baseTag = `<base href="${escapedUrl}" data-a11y-crawl-base="true">`;
  const existingBase = /<base\b[^>]*>/i.exec(html);
  if (existingBase) {
    // Preserve an author's explicit base target, but make relative targets
    // absolute because setContent starts at about:blank. This retains the
    // original base semantics without letting browser error recovery resolve
    // assets against about:blank.
    const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(existingBase[0]);
    if (href) {
      try {
        const resolved = new URL(href[2], finalUrl);
        if (resolved.protocol === "http:" || resolved.protocol === "https:") {
          const safeResolved = resolved.href
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          const replaced = existingBase[0].replace(href[0], `href="${safeResolved}"`);
          return html.replace(existingBase[0], replaced);
        }
      } catch {
        // Keep malformed/opaque base values unchanged.
      }
      return html;
    }
    // A base element without href still participates in the document's base
    // semantics. Add a valid href while preserving all other attributes.
    const attrs = existingBase[0]
      .slice(existingBase[0].indexOf("base") + 4, -1)
      .replace(/\/\s*$/, "")
      .trim();
    return html.replace(existingBase[0], `<base${attrs ? ` ${attrs}` : ""} href="${escapedUrl}">`);
  }
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) {
    return html.slice(0, head.index + head[0].length) + baseTag + html.slice(head.index + head[0].length);
  }
  // HTML parsing will create a head for this prefix; keeping the base in a
  // head element avoids relying on browser error recovery for malformed input.
  return `<head>${baseTag}</head>${html}`;
}

const WCAG_MAPPING: Record<string, { sc: string[]; level: string[] }> = {
  "ACT-R1": { sc: ["2.4.2"], level: ["A"] },
  "ACT-R2": { sc: ["1.1.1"], level: ["A"] },
  "ACT-R3": { sc: ["4.1.1"], level: ["A"] },
  "ACT-R4": { sc: ["3.1.1"], level: ["A"] },
  "ACT-R5": { sc: ["3.1.1"], level: ["A"] },
  "ACT-R6": { sc: ["3.1.1"], level: ["A"] },
  "ACT-R7": { sc: ["3.1.2"], level: ["AA"] },
  "ACT-R8": { sc: ["1.3.1", "4.1.2"], level: ["A"] },
  "ACT-R9": { sc: ["2.2.1"], level: ["A"] },
  "ACT-R10": { sc: ["1.3.5"], level: ["AA"] },
  "ACT-R11": { sc: ["2.4.4"], level: ["A"] },
  "ACT-R12": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R13": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R14": { sc: ["2.5.3"], level: ["A"] },
  "ACT-R15": { sc: ["2.4.1"], level: ["A"] },
  "ACT-R16": { sc: ["4.1.2"], level: ["WAI-ARIA"] },
  "ACT-R17": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R18": { sc: ["4.1.2"], level: ["WAI-ARIA"] },
  "ACT-R19": { sc: ["4.1.2"], level: ["WAI-ARIA"] },
  "ACT-R20": { sc: ["4.1.2"], level: ["WAI-ARIA"] },
  "ACT-R21": { sc: ["4.1.2"], level: ["WAI-ARIA"] },
  "ACT-R22": { sc: ["1.2.2"], level: ["A"] },
  "ACT-R23": { sc: ["1.2.1"], level: ["A"] },
  "ACT-R24": { sc: ["1.2.3"], level: ["A"] },
  "ACT-R25": { sc: ["1.2.5"], level: ["AA"] },
  "ACT-R26": { sc: ["1.2.1"], level: ["A"] },
  "ACT-R28": { sc: ["1.1.1", "4.1.2"], level: ["A"] },
  "ACT-R29": { sc: ["1.2.1"], level: ["A"] },
  "ACT-R30": { sc: ["1.2.1"], level: ["A"] },
  "ACT-R31": { sc: ["1.2.3"], level: ["A"] },
  "ACT-R32": { sc: [], level: ["Best Practice"] },
  "ACT-R33": { sc: ["1.2.1"], level: ["A"] },
  "ACT-R34": { sc: [], level: ["Best Practice"] },
  "ACT-R35": { sc: ["1.2.1"], level: ["A"] },
  "ACT-R36": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R37": { sc: ["1.2.5"], level: ["AA"] },
  "ACT-R38": { sc: ["1.2.3", "1.2.5", "1.2.8"], level: ["A", "AA", "AAA"] },
  "ACT-R39": { sc: ["1.1.1"], level: ["A"] },
  "ACT-R40": { sc: ["1.3.1"], level: ["WAI-ARIA"] },
  "ACT-R41": { sc: ["2.4.4"], level: ["A"] },
  "ACT-R42": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R43": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R44": { sc: ["1.3.4"], level: ["AA"] },
  "ACT-R45": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R46": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R47": { sc: ["1.4.4"], level: ["AA"] },
  "ACT-R48": { sc: ["1.4.2"], level: ["A"] },
  "ACT-R49": { sc: ["1.4.2"], level: ["A"] },
  "ACT-R50": { sc: ["1.4.2"], level: ["A"] },
  "ACT-R51": { sc: ["1.4.2"], level: ["A"] },
  "ACT-R52": { sc: ["2.4.4"], level: ["A"] },
  "ACT-R53": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R54": { sc: ["4.1.3"], level: ["AA"] },
  "ACT-R55": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R56": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R57": { sc: [], level: ["ARIA APG"] },
  "ACT-R58": { sc: ["2.4.1"], level: ["A"] },
  "ACT-R59": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R60": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R61": { sc: [], level: ["Best Practice"] },
  "ACT-R62": { sc: ["1.4.1"], level: ["A"] },
  "ACT-R63": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R64": { sc: ["2.4.6"], level: ["AA"] },
  "ACT-R65": { sc: ["2.4.7"], level: ["AA"] },
  "ACT-R66": { sc: ["1.4.6"], level: ["AAA"] },
  "ACT-R67": { sc: ["1.1.1"], level: ["A"] },
  "ACT-R68": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R69": { sc: ["1.4.3"], level: ["AA"] },
  "ACT-R70": { sc: ["4.1.1"], level: ["A"] },
  "ACT-R71": { sc: ["1.4.8"], level: ["AAA"] },
  "ACT-R72": { sc: ["1.4.8"], level: ["AAA"] },
  "ACT-R73": { sc: ["1.4.12"], level: ["AA"] },
  "ACT-R74": { sc: ["1.4.4"], level: ["AA"] },
  "ACT-R75": { sc: ["1.4.4"], level: ["AA"] },
  "ACT-R76": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R77": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R78": { sc: ["2.4.6"], level: ["AA"] },
  "ACT-R79": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R80": { sc: ["1.4.12"], level: ["AA"] },
  "ACT-R81": { sc: ["2.4.4"], level: ["A"] },
  "ACT-R82": { sc: ["3.3.1"], level: ["A"] },
  "ACT-R83": { sc: ["1.4.4"], level: ["AA"] },
  "ACT-R84": { sc: ["2.1.1"], level: ["A"] },
  "ACT-R85": { sc: ["1.4.8"], level: ["AAA"] },
  "ACT-R86": { sc: ["1.1.1"], level: ["A"] },
  "ACT-R87": { sc: ["2.4.1"], level: ["A"] },
  "ACT-R88": { sc: ["1.4.3"], level: ["AA"] },
  "ACT-R89": { sc: ["1.4.6"], level: ["AAA"] },
  "ACT-R90": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R91": { sc: ["1.4.12"], level: ["AA"] },
  "ACT-R92": { sc: ["1.4.12"], level: ["AA"] },
  "ACT-R93": { sc: ["1.4.12"], level: ["AA"] },
  "ACT-R94": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R95": { sc: ["2.1.1"], level: ["A"] },
  "ACT-R96": { sc: ["2.2.4", "3.2.5"], level: ["A"] },
  "ACT-R97": { sc: ["2.4.1"], level: ["A"] },
  "ACT-R98": { sc: ["2.4.1"], level: ["A"] },
  "ACT-R99": { sc: ["1.3.1"], level: ["A"] },
  "ACT-R100": { sc: ["2.4.1"], level: ["A"] },
  "ACT-R101": { sc: ["2.4.1"], level: ["A"] },
  "ACT-R102": { sc: ["2.4.1"], level: ["A"] },
  "ACT-R103": { sc: ["1.4.3"], level: ["AA"] },
  "ACT-R104": { sc: ["1.4.6"], level: ["AAA"] },
  "ACT-R105": { sc: [], level: ["Best Practice"] },
  "ACT-R106": { sc: [], level: ["Best Practice"] },
  "ACT-R107": { sc: [], level: ["Best Practice"] },
  "ACT-R108": { sc: [], level: ["Best Practice"] },
  "ACT-R109": { sc: ["3.1.1"], level: ["A"] },
  "ACT-R110": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R111": { sc: ["2.5.5"], level: ["AAA"] },
  "ACT-R112": { sc: [], level: ["Best Practice"] },
  "ACT-R113": { sc: ["2.5.8"], level: ["AA"] },
  "ACT-R114": { sc: ["2.4.2"], level: ["A"] },
  "ACT-R115": { sc: ["2.4.6"], level: ["AA"] },
  "ACT-R116": { sc: ["4.1.2"], level: ["A"] },
  "ACT-R117": { sc: ["1.1.1"], level: ["A"] },
  "ACT-R118": { sc: ["1.4.5", "1.4.9"], level: ["AA", "AAA"] },
  // ── WCAG 2.2 new criteria ────────────────────────────────────────────────
  "ACT-R119": { sc: ["2.4.11"], level: ["AA"] },
  "ACT-R120": { sc: ["2.4.12"], level: ["AAA"] },
  "ACT-R121": { sc: ["2.4.13"], level: ["AAA"] },
  "ACT-R122": { sc: ["2.5.7"], level: ["AA"] },
  "ACT-R124": { sc: ["3.2.6"], level: ["A"] },
  "ACT-R125": { sc: ["3.3.7"], level: ["A"] },
  "ACT-R126": { sc: ["3.3.8"], level: ["AA"] },
  "ACT-R127": { sc: ["3.3.9"], level: ["AAA"] },
  "ACT-R128": { sc: ["3.1.4"], level: ["AAA"] },
};

/** All five level identifiers recognised by the scan level selector. */
export const ALL_SCAN_LEVELS = ["A", "AA", "AAA", "WAI-ARIA", "Best Practice"] as const;
export type ScanLevel = (typeof ALL_SCAN_LEVELS)[number];

/**
 * Given a list of level names from the level selector, return the ACT rule IDs
 * whose WCAG_MAPPING entries match at least one of those levels.
 * "WAI-ARIA" in the UI covers both "WAI-ARIA" and "ARIA APG" in the mapping.
 * Returns an empty array when levels is empty (meaning: no filter, run everything).
 */
export function getRulesForLevels(levels: string[]): string[] {
  if (levels.length === 0) return [];
  const levelSet = new Set(levels);
  if (levelSet.has("WAI-ARIA")) levelSet.add("ARIA APG");
  return Object.entries(WCAG_MAPPING)
    .filter(([, v]) => v.level.some((l) => levelSet.has(l)))
    .map(([id]) => id);
}

const RULE_DESCRIPTIONS: Record<
  string,
  {
    type: RuleType;
    description: string;
    remediation: string;
    issueDescription?: string;
    potentialDescription?: string;
    deprecated?: boolean;
    deprecatedReason?: string;
    relatedRules?: string[];
  }
> = {
  "ACT-R1": {
    type: "Issue",
    description: "Page has no title",
    remediation: "Add a descriptive <title> element in the <head>",
  },
  "ACT-R2": {
    type: "Issue",
    description: "Image without a text alternative",
    remediation:
      "Provide meaningful alt text or use alt='' for decorative images",
  },
  "ACT-R3": {
    type: "Issue",
    description: "Element IDs are not unique",
    remediation: "Ensure all id attributes are unique within the page",
    deprecated: true,
    deprecatedReason:
      "SC 4.1.1 has been removed from WCAG 2.2 and is considered always passing for HTML pages in WCAG 2.1",
  },
  "ACT-R4": {
    type: "Issue",
    description: "Page language has not been identified",
    remediation: "Add a valid lang attribute to the <html> element",
  },
  "ACT-R5": {
    type: "Issue",
    description: "Page language is not valid",
    remediation: "Use a valid BCP 47 language code (e.g., en, en-US)",
  },
  "ACT-R6": {
    type: "Potential Issue",
    description: "Language declarations are inconsistent",
    remediation: "Ensure consistent and correct use of lang attributes",
    deprecated: true,
    deprecatedReason:
      "xml:lang attributes are no longer used in modern HTML; this rule is superseded by SIA-R4 and SIA-R5",
  },
  "ACT-R7": {
    type: "Issue",
    description: "Content language changes are not identified",
    remediation: "Use lang attributes on elements where language changes",
  },
  "ACT-R8": {
    type: "Issue",
    description: "Form field missing a label",
    remediation:
      "Associate labels using <label>, aria-label, or aria-labelledby",
  },
  "ACT-R9": {
    type: "Issue",
    description:
      "Page refreshes, redirects, or changes context without warning",
    remediation:
      "Avoid automatic changes of context or notify users before they occur",
  },
  "ACT-R10": {
    type: "Issue",
    description:
      "Input fields for personal data are missing autocomplete attributes",
    remediation:
      "Add appropriate autocomplete attributes (e.g., name, email, address)",
  },
  "ACT-R11": {
    type: "Issue",
    description: "Link missing a text alternative",
    remediation: "Provide descriptive link text or accessible name",
  },
  "ACT-R12": {
    type: "Issue",
    description: "Button missing a text alternative",
    remediation: "Provide visible text or aria-label for buttons",
  },
  "ACT-R13": {
    type: "Issue",
    description: "Inline frame without a text alternative",
    remediation: "Add a descriptive title attribute to iframe elements",
  },
  "ACT-R14": {
    type: "Potential Issue",
    description: "Does the accessible name contain the visible label?",
    issueDescription: "Visible label and accessible name do not match",
    potentialDescription: "Does the accessible name contain the visible label?",
    remediation: "Ensure accessible name contains the visible label text",
  },
  "ACT-R15": {
    type: "Potential Issue",
    description: "Are these inline frames identical?",
    issueDescription: "Multiple inline frames with the same text alternative",
    potentialDescription: "Are these inline frames identical?",
    remediation: "Ensure each frame has a unique and descriptive title",
  },
  "ACT-R16": {
    type: "Issue",
    description: "Required ARIA attribute is missing",
    remediation: "Ensure ARIA roles include all required states and properties",
  },
  "ACT-R17": {
    type: "Issue",
    description: "Hidden element has focusable content",
    remediation:
      "Remove focusable elements from hidden content or make them visible",
  },
  "ACT-R18": {
    type: "WAI-ARIA",
    description: "ARIA attribute unsupported or prohibited",
    remediation: "Use only supported ARIA attributes for the given role",
  },
  "ACT-R19": {
    type: "WAI-ARIA",
    description: "Invalid state or property",
    remediation: "Use valid values for ARIA attributes",
  },
  "ACT-R20": {
    type: "WAI-ARIA",
    description: "ARIA attribute does not exist",
    remediation: "Remove or correct invalid ARIA attributes",
  },
  "ACT-R21": {
    type: "Issue",
    description: "Invalid ARIA role is used",
    remediation: "Use valid ARIA roles defined in the specification",
  },
  "ACT-R22": {
    type: "Potential Issue",
    description: "Does this video have captions?",
    issueDescription: "Video without captions",
    potentialDescription: "Does this video have captions?",
    remediation: "Provide captions using <track kind='captions'>",
  },
  "ACT-R27": {
    type: "Potential Issue",
    description: "Does this video have captions?",
    issueDescription: "Video without captions",
    potentialDescription: "Does this video have captions?",
    remediation:
      "Provide captions using <track kind='captions'> and ensure the captions contain synchronized dialogue and meaningful audio information",
  },
  "ACT-R23": {
    type: "Potential Issue",
    description: "Does the audio have a transcript?",
    issueDescription: "Audio without a transcript",
    potentialDescription: "Does the audio have a transcript?",
    remediation: "Provide a transcript or equivalent alternative content",
    relatedRules: ["ACT-R38"],
  },
  "ACT-R24": {
    type: "Potential Issue",
    description: "Media alternative may be insufficient",
    remediation:
      "Review captions, transcripts, or audio alternatives and ensure they convey every meaningful piece of information in the media",
  },
  "ACT-R25": {
    type: "Potential Issue",
    description: "Is this video audio-described?",
    issueDescription: "Important visual information is not available through the video's audio",
    potentialDescription: "Does the existing audio convey all important visual information?",
    remediation:
      "Provide an audio description track or an alternative version of the video that describes all visual information",
    relatedRules: ["ACT-R37"],
  },
  "ACT-R26": {
    type: "Potential Issue",
    description: "Video without audio is a media alternative for text",
    remediation: "Provide a visible text alternative and label the video as a video alternative for text",
  },
  "ACT-R28": {
    type: "Issue",
    description: "Image button without a text alternative",
    remediation: "Provide alt text or accessible name for image buttons",
  },
  "ACT-R29": {
    type: "Potential Issue",
    description: "<audio> element content is media alternative for text",
    remediation: "Provide all auditory information as visible text included in the accessibility tree, and visibly label the audio as an alternative for text on the page",
  },
  "ACT-R30": {
    type: "Potential Issue",
    description: "Audio content has a text alternative",
    remediation:
      "Provide a text transcript or equivalent alternative for prerecorded audio",
  },
  "ACT-R31": {
    type: "Potential Issue",
    description: "<video> element content is media alternative for text",
    remediation:
      "Provide all video information as visible text included in the accessibility tree, and visibly label the video as an alternative for text on the page",
  },
  "ACT-R32": {
    type: "Potential Issue",
    description: "Visual-only video may be missing an audio-track alternative",
    remediation:
      "Provide an audio-description track or an alternative version with audio that conveys the video’s visual information",
  },
  "ACT-R33": {
    type: "Potential Issue",
    description: "Media alternative may be insufficient",
    remediation: "Ensure alternatives convey equivalent information",
  },
  "ACT-R34": {
    type: "Best Practice",
    description: "Content missing after heading",
    remediation:
      "Add content between headings of the same level to provide context",
    deprecated: true,
    deprecatedReason:
      "Deprecated in the current rule set; video description track checks are now covered by the composite ACT-R38 rule",
  },
  "ACT-R35": {
    type: "Potential Issue",
    description: "<video> element visual-only content has accessible alternative",
    remediation:
      "Provide a media alternative for text, a transcript, or an audio-track alternative for visible prerecorded video without audio",
  },
  "ACT-R36": {
    type: "Issue",
    description: "ARIA attribute is prohibited on this role",
    remediation:
      "Remove ARIA attributes that are prohibited for the element's role per the ARIA specification",
  },
  "ACT-R37": {
    type: "Potential Issue",
    description: "Does this video have a strict accessible alternative?",
    issueDescription: "Video visual content has no strict accessible alternative",
    potentialDescription: "Does this video have a strict accessible alternative?",
    remediation:
      "Provide audio description or a complete media alternative for text",
  },
  "ACT-R38": {
    type: "Potential Issue",
    description: "Is there an alternative to the visual content in this video?",
    issueDescription: "Visual-only video without an accessible alternative",
    potentialDescription:
      "Is there an alternative to the visual content in this video?",
    remediation: "Ensure video alternatives fully describe visual content",
  },
  "ACT-R39": {
    type: "Potential Issue",
    description: "Is this image file name an appropriate text alternative?",
    issueDescription: "Image file name is not an appropriate text alternative",
    potentialDescription:
      "Is this image file name an appropriate text alternative?",
    remediation: "Replace filename with meaningful alternative text",
  },
  "ACT-R40": {
    type: "WAI-ARIA",
    description: "Page region without an accessible name",
    remediation: "Provide accessible names for landmark regions",
  },
  "ACT-R41": {
    type: "Potential Issue",
    description: "Are these links identical?",
    issueDescription: "Links on the same page with the same text alternative",
    potentialDescription: "Are these links identical?",
    remediation:
      "Ensure links with same text point to same destination or differentiate them",
  },
  "ACT-R42": {
    type: "Issue",
    description: "Role not inside the required context",
    remediation: "Ensure ARIA roles are used within required parent elements",
  },
  "ACT-R43": {
    type: "Issue",
    description: "Vector image without a text alternative",
    remediation: "Provide <title> or aria-label for SVG elements",
  },
  "ACT-R44": {
    type: "Best Practice",
    description: "Page orientation is locked",
    remediation: "Allow both portrait and landscape orientations",
  },
  "ACT-R45": {
    type: "Issue",
    description: "Table headers aren't referenced correctly",
    remediation: "Use <th> elements with scope or headers attributes",
  },
  "ACT-R46": {
    type: "Issue",
    description: "No data cells assigned to table header",
    remediation: "Ensure <td> elements are properly linked to headers",
  },
  "ACT-R47": {
    type: "Issue",
    description: "Page zoom is restricted",
    remediation: "Avoid disabling zoom via viewport settings",
  },
  "ACT-R48": {
    type: "Issue",
    description:
      "<audio> or <video> that plays automatically has no audio that lasts more than 3 seconds",
    remediation: "Avoid autoplay or provide controls to stop audio",
  },
  "ACT-R49": {
    type: "Potential Issue",
    description:
      "<audio> or <video> that plays automatically has a control mechanism",
    remediation:
      "Add the controls attribute or provide custom play/pause/stop controls for any auto-playing audio or video",
  },
  "ACT-R50": {
    type: "Issue",
    description: "Audio cannot be paused or stopped",
    issueDescription: "Audio plays automatically and can't be switched off",
    potentialDescription: "Can the audio be switched off?",
    remediation: "Provide controls to pause or stop audio",
  },
  "ACT-R51": {
    type: "Issue",
    description: "Audio control is missing",
    remediation: "Provide a mechanism to control audio playback",
  },
  "ACT-R52": {
    type: "Issue",
    description: "Adjacent links do not reference the same resource",
    remediation:
      "Combine adjacent links that point to the same destination into a single link to reduce redundant navigation",
  },
  "ACT-R53": {
    type: "Best Practice",
    description: "Headings are structured",
    remediation: "Ensure logical heading order (h1 → h2 → h3)",
  },
  "ACT-R54": {
    type: "Best Practice",
    description: "Field input error is not announced in full",
    remediation:
      "Add aria-atomic='true' to assertive live regions to prevent partial/confusing announcements to screen readers",
  },
  "ACT-R55": {
    type: "Potential Issue",
    description: "Do page sections with the same name serve the same purpose?",
    remediation:
      "Give each landmark region a unique accessible name via aria-label or aria-labelledby",
  },
  "ACT-R56": {
    type: "Potential Issue",
    description: "Landmarks of same type have a unique accessible name",
    remediation:
      "Add distinct aria-label or aria-labelledby to each landmark of the same type (e.g. multiple <nav> elements)",
  },
  "ACT-R57": {
    type: "WAI-ARIA",
    description: "Text not included in an ARIA landmark",
    remediation:
      "Place all interactive elements inside landmark regions (<main>, <nav>, <header>, <footer>, <aside>, or <section aria-label>)",
  },
  "ACT-R58": {
    type: "Best Practice",
    description: "Repeated blocks of content can be bypassed",
    remediation: "Provide a mechanism to bypass repeated blocks and move directly to the main content",
  },
  "ACT-R59": {
    type: "Best Practice",
    description: "Documents have headings",
    remediation: "Add meaningful heading structure",
  },
  "ACT-R60": {
    type: "Best Practice",
    description: "Groups have an accessible name",
    remediation: "Use <fieldset> and <legend> to group related controls",
  },
  "ACT-R61": {
    type: "Best Practice",
    description: "Documents start with a level 1 heading",
    remediation:
      "Start the page with an <h1> element that describes the page topic — subsequent sections can then use h2, h3, etc.",
  },
  "ACT-R62": {
    type: "Issue",
    description: "Links are not clearly identifiable",
    remediation: "Ensure links are distinguishable beyond color alone",
  },
  "ACT-R63": {
    type: "Issue",
    description: "Object without a text alternative",
    remediation: "Provide alternative content or fallback text",
  },
  "ACT-R64": {
    type: "Potential Issue",
    description: "Empty headings",
    remediation: "Ensure headings contain meaningful text",
  },
  "ACT-R65": {
    type: "Potential Issue",
    description: "Is it clear which page element has keyboard focus?",
    issueDescription: "Keyboard focus indicator is missing",
    potentialDescription:
      "Is it clear which page element has focus from the keyboard?",
    remediation: "Ensure keyboard focus is clearly visible",
  },
  "ACT-R66": {
    type: "Issue",
    description: "Color contrast does not meet enhanced requirement",
    issueDescription: "Color contrast does not meet the minimum requirement",
    potentialDescription:
      "Is there sufficient contrast between the text and background?",
    remediation: "Ensure contrast ratio of at least 7:1",
  },
  "ACT-R67": {
    type: "Best Practice",
    description: "Decorative image exposed to assistive technologies",
    remediation: "Use alt='' or aria-hidden='true' for decorative images",
  },
  "ACT-R68": {
    type: "Issue",
    description: "Container element is empty",
    remediation:
      "Remove empty containers or provide meaningful content and appropriate semantics",
  },
  "ACT-R69": {
    type: "Potential Issue",
    description: "Color contrast does not meet minimum requirement",
    issueDescription: "Color contrast is not sufficient",
    potentialDescription:
      "Is there sufficient contrast between the text and the background?",
    remediation:
      "Ensure contrast ratio is at least 4.5:1 (or 3:1 for large text)",
  },
  "ACT-R70": {
    type: "Best Practice",
    description: "No obsolete or deprecated elements are used",
    remediation: "Replace deprecated elements with modern HTML equivalents",
  },
  "ACT-R71": {
    type: "Best Practice",
    description: "Uneven spacing in text",
    remediation:
      "Avoid text-align:justify on paragraphs — justified text creates uneven word spacing that harms readability",
  },
  "ACT-R72": {
    type: "Best Practice",
    description: "Paragraphs of text are not all uppercase",
    remediation: "Avoid using all caps for readability",
  },
  "ACT-R73": {
    type: "Best Practice",
    description: "Line height is below minimum value",
    remediation:
      "Ensure line-height is at least 1.5× the font size for readability",
  },
  "ACT-R74": {
    type: "Best Practice",
    description: "Font size is fixed",
    remediation: "Use relative units such as em or rem",
  },
  "ACT-R75": {
    type: "Best Practice",
    description: "Font sizes are not too small",
    remediation:
      "Increase font size to at least 9px — text smaller than this is extremely difficult to read",
  },
  "ACT-R76": {
    type: "Issue",
    description: "Table header cell is missing a header role",
    remediation: "Use proper <th> elements for table headers",
  },
  "ACT-R77": {
    type: "Issue",
    description: "Table data missing context",
    remediation:
      "Ensure every ID in a headers attribute matches a <th> element inside the same table",
  },
  "ACT-R78": {
    type: "Issue",
    description: "Headings of same level have text content between them",
    remediation:
      "Ensure all heading elements (h1–h6) contain descriptive text so screen readers can announce the section title",
  },
  "ACT-R79": {
    type: "Best Practice",
    description: "Preformatted text represents either code or a figure",
    remediation:
      "Wrap content inside <pre> in <code>, <kbd>, or <samp>, or place the <pre> inside a <figure> element",
  },
  "ACT-R84(link)": {
    type: "Best Practice",
    description: "Link opens in a new window/tab without warning",
    remediation:
      "Add visible text like '(opens in new tab)' or a visually-hidden equivalent inside the link",
  },
  "ACT-R80": {
    type: "Best Practice",
    description: "Line height is fixed",
    remediation: "Allow flexible line-height for better readability",
  },
  "ACT-R81": {
    type: "Potential Issue",
    description: "Do these links (in the same context) point to the same URL?",
    issueDescription:
      "Links in the same context have the same text alternative",
    potentialDescription:
      "Do these links (in the same context) point to the same URL?",
    remediation: "Ensure link text uniquely describes its destination",
  },
  "ACT-R82": {
    type: "Issue",
    description: "Error message describes invalid form field value",
    remediation:
      "Provide error messages that clearly explain what is wrong with the user's input and how to fix it",
  },
  "ACT-R83": {
    type: "Potential Issue",
    description: "Text is clipped when resized",
    remediation:
      "Use min-height instead of height, or remove overflow:hidden on containers with text content",
    deprecated: true,
    deprecatedReason:
      "Deprecated due to excessive false positives in the detection algorithm",
  },
  "ACT-R84": {
    type: "Issue",
    description: "Scrollable element is not keyboard accessible",
    remediation: "Ensure scrollable regions can be accessed via keyboard",
  },
  "ACT-R85": {
    type: "Best Practice",
    description: "Paragraphs of text are not all italics",
    remediation: "Limit use of italic text for readability",
  },
  "ACT-R86": {
    type: "Best Practice",
    description:
      "Elements that are marked as decorative are not exposed to assistive technologies",
    remediation: "Hide purely decorative elements from assistive technologies",
  },
  "ACT-R87": {
    type: "Best Practice",
    description: "Skip to main content link is missing",
    remediation: "Make the first focusable element a visible link to the main content",
  },
  "ACT-R88": {
    type: "Issue",
    description: "Text in link has minimum contrast",
    remediation:
      "Ensure link text meets the minimum WCAG contrast ratio against its background",
  },
  "ACT-R89": {
    type: "Issue",
    description: "Text in link has enhanced contrast",
    remediation:
      "Ensure link text meets the enhanced WCAG contrast ratio against its background",
  },
  "ACT-R90": {
    type: "Issue",
    description: "Role with implied hidden content has keyboard focus",
    remediation:
      "Remove nested interactive content from elements with interactive ARIA roles, and ensure focusable elements are not inside opacity:0 containers",
  },
  "ACT-R91": {
    type: "Best Practice",
    description: "Letter spacing is not wide enough",
    remediation: "Ensure letter spacing is at least 0.12em",
  },
  "ACT-R92": {
    type: "Best Practice",
    description: "Word spacing is not wide enough",
    remediation: "Ensure word spacing is at least 0.16em",
  },
  "ACT-R93": {
    type: "Best Practice",
    description: "Line height is too narrow",
    remediation: "Ensure line height is at least 1.5",
  },
  "ACT-R94": {
    type: "Issue",
    description: "Menu item missing a text alternative",
    remediation: "Provide visible text or aria-label for menu items",
  },
  "ACT-R95": {
    type: "Potential Issue",
    description:
      "<iframe> element with interactive elements does not have a negative tabindex",
    remediation:
      'Remove tabindex="-1" from iframes that contain interactive content, or ensure the content inside is accessible via an alternative mechanism',
  },
  "ACT-R96": {
    type: "Issue",
    description:
      "Refreshes implemented using the <meta> element have no delay, without exception",
    remediation:
      "Remove the meta refresh tag and use server-side redirects instead — automatic page changes without user action violate WCAG 2.2.4 and 3.2.5",
  },
  "ACT-R97": {
    type: "Potential Issue",
    description: "Document has collapsible blocks of content",
    remediation: "Ensure proper ARIA attributes and keyboard interaction",
  },
  "ACT-R98": {
    type: "Potential Issue",
    description: "Document has heading at the start of its main content",
    remediation: "Ensure main content starts with a heading",
  },
  "ACT-R99": {
    type: "Potential Issue",
    description: "Document has no main landmark",
    remediation: "Add a <main> element to define primary content",
  },
  "ACT-R100": {
    type: "Best Practice",
    description: "Document has instrument to main content",
    remediation: "Provide an accessible HTML alternative",
  },
  "ACT-R101": {
    type: "Best Practice",
    description: "Repeated content before main content can be bypassed",
    remediation: "Provide a mechanism to bypass repeated content before the main content",
  },
  "ACT-R102": {
    type: "Best Practice",
    description:
      "Document either has no repeated content, or a skip link as its first focusable element",
    remediation: "Ensure a skip link is available for keyboard users",
  },
  "ACT-R103": {
    type: "Issue",
    description: "Text in widget has minimum contrast",
    remediation: "Ensure contrast ratio meets WCAG requirements",
  },
  "ACT-R104": {
    type: "Issue",
    description: "Text in widget has enhanced contrast",
    remediation: "Ensure contrast ratio is at least 7:1 where required",
  },
  "ACT-R105": {
    type: "Issue",
    description: "Links with identical text lead to different destinations",
    remediation: "Ensure link text clearly describes destination",
  },
  "ACT-R106": {
    type: "Issue",
    description: "Invalid ARIA usage detected",
    remediation: "Correct invalid ARIA attributes and roles",
  },
  "ACT-R107": {
    type: "Issue",
    description: "Element is not accessible via keyboard",
    remediation: "Ensure all interactive elements are keyboard accessible",
  },
  "ACT-R108": {
    type: "Issue",
    description: "ARIA attributes are misused",
    remediation: "Use ARIA attributes correctly according to specification",
  },
  "ACT-R109": {
    type: "Issue",
    description: "Page language does not match content",
    remediation: "Ensure lang attribute reflects the page language",
  },
  "ACT-R110": {
    type: "Issue",
    description: "Role attribute has at least one valid value",
    remediation: "Ensure every role attribute contains at least one valid non-abstract ARIA role",
  },
  "ACT-R111": {
    type: "Issue",
    description: "Interactive element does not meet enhanced size",
    remediation: "Ensure interactive elements are at least 44×44 pixels",
  },
  "ACT-R112": {
    type: "Best Practice",
    description: "Text is styled as a heading but not marked up as one",
    remediation:
      "Use real heading elements (h1–h6) for text that visually functions as a heading",
  },
  "ACT-R113": {
    type: "Issue",
    description: "Touch target size is too small",
    remediation:
      "Ensure interactive elements are at least 24×24 pixels or have sufficient spacing",
  },
  "ACT-R114": {
    type: "Potential Issue",
    description: "Is the page title descriptive?",
    remediation: "Provide a meaningful and descriptive <title> element",
  },
  "ACT-R115": {
    type: "Potential Issue",
    description: "Is this heading descriptive?",
    remediation: "Use clear and meaningful headings that describe content",
  },
  "ACT-R116": {
    type: "Issue",
    description: "Summary element does not have an accessible name",
    remediation:
      "Provide an accessible name using visible text, aria-label, or aria-labelledby",
  },
  "ACT-R117": {
    type: "Issue",
    description: "Image does not have an accessible name",
    remediation: "Provide appropriate alt text or aria-label for images",
  },
  "ACT-R118": {
    type: "Potential Issue",
    description: "Does this image contain human-language text?",
    potentialDescription: "Does this image contain human-language text?",
    remediation:
      "Follow the manual review sequence: ask whether the image contains visible human-language text; if it does, check whether the text is decorative, incidental, essential (such as a logo), or redundant with regular text on the same page. Provide equivalent regular text when no exception applies.",
  },
  // ── WCAG 2.2 new criteria ────────────────────────────────────────────────
  "ACT-R119": {
    type: "Best Practice",
    description:
      "Fixed or sticky element may obscure keyboard focus (WCAG 2.4.11)",
    remediation:
      "Ensure keyboard-focused elements are not fully hidden behind sticky headers or footers — add scroll-margin-top/scroll-padding-top or adjust z-index/layout so focused elements remain visible",
  },
  "ACT-R120": {
    type: "Best Practice",
    description:
      "Focus not fully visible — element may be partially obscured (WCAG 2.4.12)",
    remediation:
      "Enhanced criterion: no part of the focused element should be obscured by page content — requires manual verification",
  },
  "ACT-R121": {
    type: "Best Practice",
    description:
      "Focus indicator suppressed without visible replacement (WCAG 2.4.13)",
    remediation:
      "Do not set outline:none on :focus/:focus-visible without providing an equivalent focus indicator via box-shadow, border, or background-color change with sufficient contrast",
  },
  "ACT-R122": {
    type: "Best Practice",
    description: "Dragging interaction has no pointer alternative (WCAG 2.5.7)",
    remediation:
      "All functionality that requires dragging must also be operable by a single pointer action (click, tap) — requires manual verification",
  },
  "ACT-R124": {
    type: "Best Practice",
    description:
      "Help mechanism not consistently located across pages (WCAG 3.2.6)",
    remediation:
      "If a help mechanism (chat, phone, FAQ link) appears on multiple pages it must appear in the same relative order in the page layout — requires manual cross-page verification",
  },
  "ACT-R125": {
    type: "Best Practice",
    description:
      "User required to re-enter information already provided (WCAG 3.3.7)",
    remediation:
      "Do not ask users to re-enter information already submitted in the same session — pre-populate fields or offer auto-fill — requires manual verification of multi-step flows",
  },
  "ACT-R126": {
    type: "Best Practice",
    description:
      "Accessible authentication — CAPTCHA may block users with cognitive disabilities (WCAG 3.3.8)",
    remediation:
      "Provide an accessible alternative to CAPTCHA (e.g. audio CAPTCHA, email link, passkey) so users are not required to solve a cognitive function test to authenticate",
  },
  "ACT-R127": {
    type: "Best Practice",
    description:
      "Accessible authentication (enhanced) — no cognitive function test permitted (WCAG 3.3.9)",
    remediation:
      "AAA: authentication must work without any cognitive test — provide passkey, magic link, or SSO — requires manual verification",
  },
  "ACT-R128": {
    type: "Potential Issue",
    description:
      "Abbreviations and acronyms should have their full expansion available",
    remediation:
      "Provide the full meaning at first use in visible text, an <abbr title>, or an equivalent glossary entry (WCAG 3.1.4, AAA)",
  },
};

// Persistent profile dir — preserves Cloudflare clearance cookies across restarts
const CHROME_PROFILE_DIR =
  process.env["CHROME_PROFILE_DIR"] ??
  path.join(process.env["HOME"] ?? "/tmp", ".cache", "a11y-chrome-profile");
try {
  mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
} catch {
  /* already exists */
}

const LOCK_NAMES = ["SingletonLock", "SingletonCookie", "SingletonSocket"];

/** Remove stale Chrome singleton lock files from a given directory */
function removeLocks(dir: string): void {
  for (const name of LOCK_NAMES) {
    const f = path.join(dir, name);
    if (existsSync(f)) {
      try {
        rmSync(f, { force: true });
        logger.info({ file: f }, "Removed stale Chrome lock file");
      } catch (e) {
        logger.warn({ file: f, err: e }, "Could not remove Chrome lock file");
      }
    }
  }
}

/**
 * Remove stale Chrome singleton lock files from the profile dir and all
 * immediate subdirectories (covers proxy/, session-* dirs, etc.).
 */
function clearChromeLocks(): void {
  removeLocks(CHROME_PROFILE_DIR);
  // Sweep one level of subdirs so proxy/ and stale session-* dirs are cleaned
  try {
    for (const entry of readdirSync(CHROME_PROFILE_DIR, {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) {
        removeLocks(path.join(CHROME_PROFILE_DIR, entry.name));
      }
    }
  } catch {
    // profile dir may not exist yet — ignore
  }
}

const PUPPETEER_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--window-size=1440,900",
  "--lang=en-US,en;q=0.9",
  "--disable-blink-features=AutomationControlled",
  // Memory-saving flags
  "--disable-background-networking",
  "--disable-sync",
  "--no-first-run",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-translate",
  "--mute-audio",
  "--hide-scrollbars",
  "--renderer-process-limit=2",
];

// ─── Browser worker pool ──────────────────────────────────────────────────────
// Each slot owns its own Chromium instance (unique session userDataDir) and its
// own mutex chain, so up to POOL_SIZE pages can be scanned concurrently while
// each individual browser still processes one page at a time.
interface BrowserSlot {
  browser: Browser | null;
  chain: Promise<void>;
  pending: number;
}

let _poolSize = 4;
const _pool: BrowserSlot[] = [];

function ensurePool(): BrowserSlot[] {
  while (_pool.length < _poolSize) {
    _pool.push({ browser: null, chain: Promise.resolve(), pending: 0 });
  }
  return _pool;
}

/** Set how many browser workers run in parallel (1–8). Applies to new work immediately. */
export function setScanConcurrency(n: number): void {
  const clamped = Math.max(1, Math.min(8, Math.floor(n)));
  if (clamped !== _poolSize) {
    logger.info(
      { from: _poolSize, to: clamped },
      "Scan browser pool size changed",
    );
    _poolSize = clamped;
    // Shrinking: close surplus browsers once their chains drain.
    while (_pool.length > _poolSize) {
      const slot = _pool.pop()!;
      slot.chain.then(() => slot.browser?.close().catch(() => {}));
    }
  }
}

export function getScanConcurrency(): number {
  return _poolSize;
}

async function getBrowser(slot: BrowserSlot): Promise<Browser> {
  if (slot.browser && slot.browser.connected) {
    return slot.browser;
  }

  // Clear any stale lock files left by a crashed previous process
  clearChromeLocks();

  const executablePath = getChromiumPath();
  logger.info(
    {
      profileDir: CHROME_PROFILE_DIR,
      executablePath: executablePath ?? "(puppeteer internal default)",
    },
    "Launching browser for accessibility scanning",
  );

  const launchOptions = {
    headless: true as const,
    executablePath,
    userDataDir: path.join(
      CHROME_PROFILE_DIR,
      `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ),
    args: PUPPETEER_LAUNCH_ARGS,
    // Cap how long Puppeteer waits for any single Chrome DevTools Protocol
    // message.  Without this the default (180 s) allows a stuck page.goto()
    // to hang far beyond our own hard-deadline timer.
    // Navigation is retried for slow/WAF-protected pages. Keep the CDP budget
    // above the complete retry window so Runtime.callFunctionOn does not time
    // out while Puppeteer is still waiting for the page to settle.
    protocolTimeout: 300_000,
  };

  // Cap the launch so a hung Chrome process never blocks forever.
  // 30 s is ample — a healthy launch takes < 5 s; anything longer means Chrome is stuck.
  const LAUNCH_TIMEOUT_MS = 30_000;

  // Retry up to 3 times with increasing delays.
  //
  // Why: on Azure App Service, startup.sh installs Chrome asynchronously
  // before starting Node. If a scan is created right as the server comes up
  // (e.g. orphan recovery kicks in before startup.sh finishes writing to
  // the cache), the first launch attempt will fail with "executablePath not
  // found". Waiting and retrying lets Chrome installation complete so the
  // next attempt succeeds — without failing the scan page permanently.
  //
  // The same retry also absorbs transient browser crashes: if Chrome was
  // killed by the OOM reaper between two mutex slots, the second attempt
  // (with a fresh userDataDir) succeeds normally.
  const MAX_LAUNCH_RETRIES = 3;
  const LAUNCH_RETRY_BASE_DELAY_MS = 5_000;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_LAUNCH_RETRIES; attempt++) {
    try {
      const launched = await Promise.race([
        puppeteerExtra.launch(launchOptions) as Promise<Browser>,
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Browser launch timed out after ${LAUNCH_TIMEOUT_MS}ms`,
                ),
              ),
            LAUNCH_TIMEOUT_MS,
          ),
        ),
      ]);
      slot.browser = launched;

      launched.on("disconnected", () => {
        logger.warn("Browser disconnected — will relaunch on next scan page");
        if (slot.browser === launched) slot.browser = null;
      });

      if (attempt > 1) {
        logger.info({ attempt }, "Browser launched successfully after retry");
      }

      return launched;
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);

      // Profile lock errors — clear locks before retrying
      if (
        msg.includes("SingletonLock") ||
        msg.includes("profile") ||
        msg.includes("already in use") ||
        msg.includes("process_singleton")
      ) {
        logger.warn(
          { error: msg, attempt },
          "Browser launch failed with profile lock — clearing",
        );
        clearChromeLocks();
      } else {
        logger.warn(
          { error: msg, attempt, maxAttempts: MAX_LAUNCH_RETRIES },
          "Browser launch failed",
        );
      }

      if (attempt < MAX_LAUNCH_RETRIES) {
        const delayMs = LAUNCH_RETRY_BASE_DELAY_MS * attempt; // 5s, 10s
        logger.info(
          { delayMs, attempt },
          "Waiting before retrying browser launch",
        );
        await new Promise<void>((r) => setTimeout(r, delayMs));
        // Re-resolve the path on each retry — startup.sh may have finished
        // installing Chrome since the last attempt.
        launchOptions.executablePath = getChromiumPath();
        logger.info(
          {
            executablePath:
              launchOptions.executablePath ?? "(puppeteer internal default)",
          },
          "Retrying browser launch",
        );
      }
    }
  }

  throw lastErr;
}

/**
 * Scroll through the entire page to trigger lazy-loaded content, then wait
 * for the DOM to stabilise (no new nodes for 800ms or max 8s).
 */
async function fullyRenderPage(page: Page, timeout: number): Promise<void> {
  // Get total page height
  const totalHeight: number = await page.evaluate(
    () => document.body.scrollHeight,
  );
  const viewportHeight = 900;
  const scrollStep = Math.max(viewportHeight, 400);

  for (let scrolled = 0; scrolled < totalHeight; scrolled += scrollStep) {
    await page.evaluate((y: number) => window.scrollTo(0, y), scrolled);
    // Short pause between scroll steps so lazy loaders can fire
    await new Promise((r) => setTimeout(r, 300));
  }

  // Scroll back to top so layout is representative of what a user sees
  await page.evaluate(() => window.scrollTo(0, 0));

  // Wait for DOM to stabilise: poll node count every 500ms until stable
  const stabiliseDeadline = Date.now() + Math.min(timeout * 0.4, 8000);
  let prevCount = -1;
  while (Date.now() < stabiliseDeadline) {
    const count: number = await page.evaluate(
      () => document.querySelectorAll("*").length,
    );
    if (count === prevCount) break;
    prevCount = count;
    await new Promise((r) => setTimeout(r, 500));
  }

  // Final pause to let any post-render JS finish
  await new Promise((r) => setTimeout(r, 1000));
}

interface SnapshotLayoutEntry {
  marker: string;
  style: string | null;
  scrollTop: number;
}

/**
 * Some sites keep the document itself fixed to the viewport and put the real
 * page inside a full-screen overflow:auto container. Puppeteer's fullPage
 * screenshot only follows the document height, so those pages otherwise store
 * a viewport-only image even when fullPage:true succeeds.
 */
async function expandPageScrollerForSnapshot(
  page: Page,
): Promise<SnapshotLayoutEntry[]> {
  return page.evaluate(() => {
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight + 4 &&
          rect.width * rect.height >= viewportArea * 0.5
        );
      })
      .sort((left, right) => {
        const leftOverflow = left.scrollHeight - left.clientHeight;
        const rightOverflow = right.scrollHeight - right.clientHeight;
        return rightOverflow - leftOverflow;
      });

    const pageScroller = candidates[0];
    if (!pageScroller) return [];

    const elements: HTMLElement[] = [];
    let current: HTMLElement | null = pageScroller;
    while (current) {
      elements.push(current);
      current = current.parentElement;
    }

    const entries = elements.map((element, index) => {
      const marker = `snapshot-layout-${index}`;
      element.dataset.amperaSnapshotLayout = marker;
      return {
        marker,
        style: element.getAttribute("style"),
        scrollTop: element.scrollTop,
      };
    });

    for (const element of elements) {
      element.style.setProperty("max-height", "none", "important");
      element.style.setProperty("overflow", "visible", "important");
      element.style.setProperty("overflow-y", "visible", "important");
      element.scrollTop = 0;
    }
    pageScroller.style.setProperty(
      "height",
      `${pageScroller.scrollHeight}px`,
      "important",
    );
    for (const ancestor of elements.slice(1)) {
      ancestor.style.setProperty("height", "auto", "important");
    }
    window.scrollTo(0, 0);

    return entries;
  });
}

async function restoreSnapshotLayout(
  page: Page,
  entries: SnapshotLayoutEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await page.evaluate((savedEntries) => {
    for (const entry of savedEntries) {
      const element = document.querySelector<HTMLElement>(
        `[data-ampera-snapshot-layout="${entry.marker}"]`,
      );
      if (!element) continue;
      if (entry.style === null) {
        element.removeAttribute("style");
      } else {
        element.setAttribute("style", entry.style);
      }
      element.scrollTop = entry.scrollTop;
      delete element.dataset.amperaSnapshotLayout;
    }
  }, entries);
}

// ─── Proxy browser management ─────────────────────────────────────────────────
// Proxy scans need a separate Chromium instance launched with either
// --proxy-pac-url (for PAC files) or --proxy-server (for direct proxy URLs).
// We cache one proxy browser per proxy URL to avoid relaunching on every page.

/**
 * Returns true if the error string looks like a proxy-level network failure
 * (the proxy itself is unreachable or doesn't support HTTPS CONNECT tunneling),
 * as opposed to a problem with the target page.
 */
async function hydrateVisualImages(
  page: Page,
): Promise<{ images: number; backgrounds: number; loaded: number; failed: number }> {
  return page.evaluate(async () => {
    let images = 0;
    let backgrounds = 0;
    const visualUrls = new Set<string>();

    const absoluteUrl = (value: string): string | null => {
      try {
        return new URL(value, document.baseURI).href;
      } catch {
        return null;
      }
    };

    const collectBackgroundUrls = (value: string): void => {
      for (const match of value.matchAll(
        /url\((?:"([^"]+)"|'([^']+)'|([^)'"]+))\)/g,
      )) {
        const url = absoluteUrl(match[1] || match[2] || match[3] || "");
        if (url && !url.startsWith("data:")) visualUrls.add(url);
      }
    };

    for (const img of Array.from(document.images)) {
      const currentSrc = img.currentSrc || img.getAttribute("src") || "";
      const srcset = img.getAttribute("srcset");
      const dataSrc = img.getAttribute("data-src") || "";
      const dataSrcset = img.getAttribute("data-srcset") || "";
      const source =
        currentSrc || img.getAttribute("src") || dataSrc || srcset || dataSrcset;

      if (
        !source ||
        source.startsWith("data:") ||
        (img.complete && img.naturalWidth > 0)
      ) {
        if (source && !source.startsWith("data:")) {
          const url = absoluteUrl(source);
          if (url) visualUrls.add(url);
        }
        continue;
      }

      img.loading = "eager";
      if (!img.getAttribute("src") && dataSrc) {
        img.setAttribute("src", dataSrc);
      }
      if (!img.getAttribute("srcset") && dataSrcset) {
        img.setAttribute("srcset", dataSrcset);
      }

      const retrySrcset = img.getAttribute("srcset") || srcset || dataSrcset;
      const retrySrc = img.getAttribute("src") || dataSrc || currentSrc;
      if (retrySrcset) {
        img.removeAttribute("srcset");
        img.setAttribute("srcset", retrySrcset);
      }
      if (retrySrc) {
        img.removeAttribute("src");
        img.setAttribute("src", retrySrc);
        const url = absoluteUrl(retrySrc);
        if (url) visualUrls.add(url);
      }
      images++;
    }

    for (const source of Array.from(
      document.querySelectorAll<HTMLSourceElement>(
        "picture > source[srcset], picture > source[data-srcset]",
      ),
    )) {
      const srcset = source.getAttribute("srcset");
      const dataSrcset = source.getAttribute("data-srcset") || "";
      const retrySrcset = srcset || dataSrcset;
      if (!retrySrcset) continue;
      source.removeAttribute("srcset");
      source.setAttribute("srcset", retrySrcset);
    }

    for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      let backgroundImage = window.getComputedStyle(el).backgroundImage;
      const lazyBackground =
        el.getAttribute("data-original") ||
        el.getAttribute("data-bg") ||
        el.getAttribute("data-background-image");
      if (
        lazyBackground &&
        (!backgroundImage || backgroundImage === "none")
      ) {
        const url = absoluteUrl(lazyBackground);
        if (url) {
          backgroundImage = `url("${url.replaceAll('"', '\\"')}")`;
          el.style.setProperty("background-image", backgroundImage, "important");
        }
      }
      if (
        !backgroundImage ||
        backgroundImage === "none" ||
        !backgroundImage.includes("url(")
      ) {
        continue;
      }
      collectBackgroundUrls(backgroundImage);
      el.style.backgroundImage = "none";
      void el.offsetWidth;
      el.style.backgroundImage = backgroundImage;
      backgrounds++;
    }

    // Requests made during the fast rule pass are intentionally aborted.
    // Re-applying the same CSS value does not make Chromium retry every failed
    // resource, so explicitly preload each visual URL after images are enabled.
    const settled = await Promise.all(
      Array.from(visualUrls)
        .slice(0, 100)
        .map(
          (url) =>
            new Promise<boolean>((resolve) => {
              const image = new Image();
              const timer = window.setTimeout(() => resolve(false), 10_000);
              image.onload = () => {
                window.clearTimeout(timer);
                resolve(true);
              };
              image.onerror = () => {
                window.clearTimeout(timer);
                resolve(false);
              };
              image.src = url;
            }),
        ),
    );

    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    return {
      images,
      backgrounds,
      loaded: settled.filter(Boolean).length,
      failed: settled.filter((loaded) => !loaded).length,
    };
  });
}

function isProxyNetworkError(error: string): boolean {
  return (
    error.includes("ERR_EMPTY_RESPONSE") ||
    error.includes("ERR_TUNNEL_CONNECTION_FAILED") ||
    error.includes("ERR_PROXY_CONNECTION_FAILED") ||
    error.includes("ERR_NO_SUPPORTED_PROXIES") ||
    (error.includes("ERR_FAILED") && error.includes("proxy"))
  );
}

/**
 * Determine which Chromium proxy flag to use:
 * - SOCKS proxies (socks4://, socks5://) → --proxy-server
 * - HTTP/HTTPS with an explicit port (e.g. http://host:9002) → --proxy-server
 * - Anything else (e.g. http://host/proxy.pac) → --proxy-pac-url
 */
function classifyProxy(proxyUrl: string): "--proxy-pac-url" | "--proxy-server" {
  try {
    const parsed = new URL(proxyUrl);
    if (
      parsed.protocol === "socks4:" ||
      parsed.protocol === "socks5:" ||
      parsed.protocol === "socks:"
    ) {
      return "--proxy-server";
    }
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.port !== ""
    ) {
      return "--proxy-server";
    }
  } catch {
    // fall through to PAC default
  }
  return "--proxy-pac-url";
}

let _proxyBrowserInstance: Browser | null = null;
let _currentProxyUrl: string | null = null;

async function getProxyBrowser(proxyUrl: string): Promise<Browser> {
  // Reuse if same proxy URL and browser is still connected
  if (
    _proxyBrowserInstance &&
    _proxyBrowserInstance.connected &&
    _currentProxyUrl === proxyUrl
  ) {
    return _proxyBrowserInstance;
  }

  // Close old proxy browser if proxy URL changed
  if (_proxyBrowserInstance && _proxyBrowserInstance.connected) {
    await _proxyBrowserInstance.close().catch(() => {});
    _proxyBrowserInstance = null;
  }

  // Use a fresh temp dir each time so stale SingletonLock files from a prior
  // container hostname never block the launch.
  const proxySessionDir = path.join(
    os.tmpdir(),
    `chrome-proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  const proxyFlag = classifyProxy(proxyUrl);
  logger.info(
    { proxyUrl, proxyFlag, proxySessionDir },
    "Launching proxy browser",
  );

  _proxyBrowserInstance = await puppeteerExtra.launch({
    headless: true,
    executablePath: getChromiumPath(),
    userDataDir: proxySessionDir,
    args: [
      ...PUPPETEER_LAUNCH_ARGS,
      `${proxyFlag}=${proxyUrl}`,
      // Ignore certificate errors on internal/staging environments
      "--ignore-certificate-errors",
      "--ignore-ssl-errors",
    ],
  });

  _currentProxyUrl = proxyUrl;

  _proxyBrowserInstance.on("disconnected", () => {
    logger.warn("Proxy browser disconnected");
    _proxyBrowserInstance = null;
    _currentProxyUrl = null;
  });

  return _proxyBrowserInstance;
}

// ─── Scan dispatch ────────────────────────────────────────────────────────────
// Each pool slot has its own mutex chain: one page at a time per browser, but
// up to _poolSize pages across the pool. Slots use isolated session
// userDataDirs, so there is no Chrome profile-lock contention between them.

export function scanPage(
  url: string,
  options: {
    /** Navigation timeout in ms — how long to wait for DOMContentLoaded. Default 30 s. */
    timeout?: number;
    /** Post-load dwell time in ms — scanner waits this long after DOMContentLoaded, letting JS
     *  execute and render content, before running accessibility checks. Default 0. */
    scanDelayMs?: number;
    bypassCSP?: boolean;
    rules?: string[];
    proxyPacUrl?: string;
    /** System-level proxy PAC URL to use as a fallback if a page returns 403 on the direct IP.
     *  Ignored when proxyPacUrl is already set (proxy is already in use). */
    fallbackProxyPacUrl?: string;
    disableJavascript?: boolean;
    onStage?: (stage: string) => void | Promise<void>;
    signal?: AbortSignal;
    /** Pre-captured HTML from crawl boost Phase 1. When set, uses page.setContent() instead of page.goto() — no Cloudflare challenge, no network wait. */
    preloadHtml?: string;
    /** Authoritative response metadata captured alongside preloadHtml in Phase 1. */
    preloadMetadata?: PreloadedPageMetadata;
    /** Shared static preflight promise supplied by scanQueue to avoid duplicate HTTP fetches. */
    staticPreflightPromise?: Promise<StaticHtmlPreflight | undefined>;
  } = {},
): Promise<PageScanResult> {
  // Pick the least-loaded slot in the pool.
  const pool = ensurePool();
  let slot = pool[0]!;
  for (const s of pool) {
    if (s.pending < slot.pending) slot = s;
  }
  slot.pending++;
  const result = slot.chain.then(() => _scanPageInternal(url, options, slot));
  // Advance the slot's mutex when the scan completes (success or error).
  // Safety valve: also advance after a hard cap in case _scanPageInternal hangs
  // before the abort handler is registered (e.g. Chrome crash inside getBrowser/newPage).
  // Without this the slot deadlocks permanently.
  // _scanPageInternal may use three navigation attempts (30s/60s/90s).
  // Keep the slot watchdog above that full window so it cannot release the
  // mutex while the underlying page is still active.
  const mutexCap =
    (options.timeout ?? 30_000) * 6 + (options.scanDelayMs ?? 0) + 90_000;
  const settled = result.then(
    () => {},
    () => {},
  );
  settled.then(() => {
    slot.pending = Math.max(0, slot.pending - 1);
  });
  slot.chain = Promise.race([
    settled,
    new Promise<void>((r) => setTimeout(r, mutexCap)),
  ]);
  return result;
}

// Well-known analytics / tracking / ad-tech hosts.  Requests to these are
// aborted during scans: they never affect accessibility rule results, but
// their long-polling beacons keep the network busy and slow page settling.
const TRACKER_HOSTS = [
  "google-analytics.com",
  "analytics.google.com",
  "googletagmanager.com",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "stats.g.doubleclick.net",
  "connect.facebook.net",
  "facebook.com/tr",
  "bat.bing.com",
  "clarity.ms",
  "hotjar.com",
  "mouseflow.com",
  "fullstory.com",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "heapanalytics.com",
  "quantserve.com",
  "scorecardresearch.com",
  "adobedtm.com",
  "demdex.net",
  "omtrdc.net",
  "krxd.net",
  "criteo.com",
  "criteo.net",
  "taboola.com",
  "outbrain.com",
  "yandex.ru/metrika",
  "mc.yandex.ru",
  "matomo.cloud",
  "plausible.io",
  "newrelic.com",
  "nr-data.net",
  "sentry.io",
  "bugsnag.com",
  "onetrust.com/consent-receipts",
  "px-cloud.net",
  "branch.io",
  "braze.com",
  "appsflyer.com",
  "adsrvr.org",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "casalemedia.com",
  "adnxs.com",
  "linkedin.com/px",
  "px.ads.linkedin.com",
  "snap.licdn.com",
  "ads-twitter.com",
  "static.ads-twitter.com",
  "tiktok.com/i18n/pixel",
  "analytics.tiktok.com",
];

function isTrackerUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const hostPath = `${u.hostname}${u.pathname}`;
    return TRACKER_HOSTS.some(
      (t) =>
        u.hostname === t ||
        u.hostname.endsWith(`.${t}`) ||
        hostPath.includes(t),
    );
  } catch {
    return false;
  }
}

const MAX_REPLAY_STYLESHEET_BYTES = 5 * 1024 * 1024;

/**
 * Serialize the current DOM together with the CSS that Chromium actually
 * loaded. Replays are deliberately network-isolated, so leaving external
 * <link> elements in page.content() produces an unstyled and often badly
 * distorted document.
 */
async function captureReplayHtml(
  page: Page,
  stylesheetResponses: Map<string, Promise<string | null>>,
): Promise<string> {
  const cssEntries: Array<[string, string]> = [];
  let capturedBytes = 0;
  for (const [url, pendingCss] of stylesheetResponses) {
    const css = await pendingCss.catch(() => null);
    if (!css) continue;
    const bytes = Buffer.byteLength(css);
    if (capturedBytes + bytes > MAX_REPLAY_STYLESHEET_BYTES) break;
    capturedBytes += bytes;
    cssEntries.push([url, css]);
  }

  return page.evaluate((loadedStylesheets) => {
    const cssByUrl = new Map(loadedStylesheets);
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    const sourceLinks = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'),
    );
    const clonedLinks = Array.from(
      clone.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'),
    );

    sourceLinks.forEach((sourceLink, index) => {
      const clonedLink = clonedLinks[index];
      if (!clonedLink) return;
      let css = cssByUrl.get(sourceLink.href) ?? "";
      if (!css && sourceLink.sheet) {
        try {
          css = Array.from(sourceLink.sheet.cssRules)
            .map((rule) => rule.cssText)
            .join("\n");
        } catch {
          // Cross-origin CSSOM access can be denied. The captured response is
          // used above when available; otherwise omit the unusable link.
        }
      }
      if (!css) {
        clonedLink.remove();
        return;
      }
      const style = document.createElement("style");
      style.setAttribute("data-a11y-replay-stylesheet", sourceLink.href);
      style.textContent = css;
      clonedLink.replaceWith(style);
    });

    const doctype = document.doctype
      ? `<!DOCTYPE ${document.doctype.name}>`
      : "<!doctype html>";
    return `${doctype}\n${clone.outerHTML}`;
  }, cssEntries);
}

async function _scanPageInternal(
  url: string,
  options: {
    timeout?: number;
    scanDelayMs?: number;
    bypassCSP?: boolean;
    rules?: string[];
    proxyPacUrl?: string;
    fallbackProxyPacUrl?: string;
    disableJavascript?: boolean;
    onStage?: (stage: string) => void | Promise<void>;
    signal?: AbortSignal;
    preloadHtml?: string;
    preloadMetadata?: PreloadedPageMetadata;
    staticPreflightPromise?: Promise<StaticHtmlPreflight | undefined>;
  } = {},
  slot?: BrowserSlot,
): Promise<PageScanResult> {
  const {
    timeout = 30_000,
      scanDelayMs = 10_000,
    bypassCSP = true,
    disableJavascript = false,
    onStage,
  } = options;
  const browserSlot = slot ?? ensurePool()[0]!;
  // This is deliberately advisory. A static response can identify an error or
  // challenge, but Chromium remains authoritative for the rendered page.
  const staticPreflightPromise: Promise<StaticHtmlPreflight | undefined> =
    options.preloadHtml || !shouldRunStaticPreflight(options.proxyPacUrl)
      ? Promise.resolve(undefined)
      : (options.staticPreflightPromise ?? runStaticHtmlPreflight(url));

  let page: Page | null = null;
  // When the external hard-timeout AbortSignal fires, force-close the page so
  // that any pending page.goto() / page.evaluate() throws immediately and the
  // mutex is released for the next URL.
  let abortHandler: (() => void) | null = null;

  try {
    // Bail out early if already aborted before we even open a page
    if (options.signal?.aborted) {
      return { url, issues: [], error: "URL scan aborted before navigation" };
    }

    // Helper: race any promise against the abort signal so we can cancel even
    // before the Puppeteer page object exists (e.g. during getBrowser/newPage).
    function raceAbort<T>(promise: Promise<T>, label: string): Promise<T> {
      const sig = options.signal;
      if (!sig) return promise;
      if (sig.aborted)
        return Promise.reject(new Error(`${label}: already aborted`));
      return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(new Error(`${label}: aborted by signal`));
        sig.addEventListener("abort", onAbort, { once: true });
        promise.then(
          (v) => {
            sig.removeEventListener("abort", onAbort);
            resolve(v);
          },
          (e) => {
            sig.removeEventListener("abort", onAbort);
            reject(e);
          },
        );
      });
    }

    const browser = await raceAbort(
      options.proxyPacUrl
        ? getProxyBrowser(options.proxyPacUrl)
        : getBrowser(browserSlot),
      "getBrowser",
    );
    page = await raceAbort(browser.newPage(), "newPage");

    // Wire abort signal → force page close so any in-flight page ops throw immediately
    if (options.signal) {
      const capturedPage = page;
      abortHandler = () => {
        capturedPage.close().catch(() => {});
      };
      options.signal.addEventListener("abort", abortHandler, { once: true });
    }

    if (bypassCSP) {
      await page.setBypassCSP(true);
    }

    if (disableJavascript) {
      await page.setJavaScriptEnabled(false);
    }

    await page.setViewport({ width: 1440, height: 900 });
    page.setDefaultNavigationTimeout(timeout);
    page.setDefaultTimeout(timeout);

    // Block resource types that are irrelevant for accessibility scanning.
    // Images, fonts, and media account for the vast majority of page weight and
    // are the most common reason navigations hang (slow CDN, large video streams,
    // infinite analytics beacons).  Blocking them cuts load time by 50–80% on
    // media-heavy pages without affecting any accessibility rule evaluation.
    // We keep: document, script, stylesheet, xhr, fetch, websocket, other —
    // scripts drive dynamic content & redirects; stylesheets affect computed
    // visibility used by several rules.  Analytics/tracker requests are also
    // blocked by hostname (see TRACKER_HOSTS).
    let allowVisualImages = false;
    let allowMediaMetadata = false;
    const replayStylesheets = new Map<string, Promise<string | null>>();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (
        (type === "image" && !allowVisualImages) ||
        (type === "media" && !allowMediaMetadata) ||
        type === "font"
      ) {
        req.abort().catch(() => {});
        return;
      }
      // Block analytics/tracker beacons — they add network noise, keep the
      // page "busy" (delaying DOM stability), and have zero effect on
      // accessibility rule evaluation.  CSS and first-party scripts still load.
      if (isTrackerUrl(req.url())) {
        req.abort().catch(() => {});
        return;
      }
      req.continue().catch(() => {});
    });
    page.on("response", (response) => {
      try {
        const request = response.request();
        if (
          request.resourceType() === "stylesheet" &&
          response.status() >= 200 &&
          response.status() < 300
        ) {
          replayStylesheets.set(
            response.url(),
            response.text().catch(() => null),
          );
        }
      } catch {
        // The page may close while a stylesheet response is being processed.
      }
    });

    // Set a realistic Chrome user-agent and request headers to minimise bot detection
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Sec-Ch-Ua":
        '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "Cache-Control": "max-age=0",
    });

    // Intercept Element.prototype.setAttribute before any page scripts run so we
    // can detect aria-label values that start as "" (bare SSR placeholder) and
    // then get patched by JS to a non-empty string (e.g. AEM writes
    // "E7515RUXMforRedCap" — an image asset ID, not a real label).
    // R11 reads window.__ariaLabelWasEmpty__ (WeakSet) at scan time to flag these
    // even though getAccessibleName() now returns a non-empty string.
    // Using setAttribute interception instead of MutationObserver because it fires
    // synchronously regardless of whether the element is in the DOM yet.
    await page.evaluateOnNewDocument(() => {
      const tracked = new WeakSet<Element>();
      // Expose on window so the rule evaluation context can read it
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__ariaLabelWasEmpty__ = tracked;
      const clickTargets = new WeakSet<EventTarget>();
      (window as any).__amperaClickTargets__ = clickTargets;

      // Track direct click handlers installed by page scripts. This lets the
      // button-name rule recognize custom controls such as an empty
      // <div id="btn-next"> without treating every generic container as a
      // button. The original method is called unchanged so page behavior is
      // unaffected.
      const origAddEventListener = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ): void {
        if (type.toLowerCase() === "click" && this instanceof Element) {
          clickTargets.add(this);
        }
        origAddEventListener.call(this, type, listener, options);
      };

      const origSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (
        name: string,
        value: string,
      ): void {
        if (name === "aria-label") {
          // getAttribute before the change — null means attribute absent, "" means bare
          const current = this.getAttribute("aria-label");
          const currentTrimmed = (current ?? "").trim();
          const newTrimmed = (value ?? "").trim();
          // Was absent or empty → being set to something non-empty: JS patch detected
          if (!currentTrimmed && newTrimmed) {
            tracked.add(this);
          }
        }
        origSetAttribute.call(this, name, value);
      };

      // SSR-state snapshot for R11.
      // Fires during HTML parsing (before any deferred/async page scripts),
      // stamping <a> elements with custom data attributes so that R11 can
      // detect "link had no accessible name in source HTML" even after JS
      // patches the accessible name.  We use origSetAttribute to avoid
      // re-entering our own aria-label interceptor.
      //
      // Stamps applied:
      //   data-r11-bare-ssr   — link had aria-label="" (bare) in SSR HTML
      //   data-r11-no-name-ssr — link had NO accessible name at all in SSR:
      //                         no aria-label, no aria-labelledby, no title,
      //                         no visible text, no img[alt] (e.g. a
      //                         presentation carousel slide with an empty img).
      //
      // Debug counter exposed at window.__r11SsrCount__ = { bare, noName }.
      (window as any).__r11SsrCount__ = { bare: 0, noName: 0 };

      function auditLinkSsr(a: Element): void {
        const role = a.getAttribute("role");
        // Presentation/none links don't need a name
        if (role === "presentation" || role === "none") return;

        const ariaLabel = (a.getAttribute("aria-label") ?? "").trim();
        const hasLabelledBy = !!a.getAttribute("aria-labelledby");
        const hasTitle = !!(a.getAttribute("title") ?? "").trim();

        // Bare aria-label (attribute present but empty)
        if (a.hasAttribute("aria-label") && !ariaLabel) {
          origSetAttribute.call(a, "data-r11-bare-ssr", "");
          (window as any).__r11SsrCount__.bare++;
          return;
        }

        // No accessible name at all — no label, no labelledby, no title, no
        // text, no img with non-empty alt.  Only flag real navigational links
        // (href present and not a fragment/void anchor).
        if (!ariaLabel && !hasLabelledBy && !hasTitle) {
          const href = (a.getAttribute("href") ?? "").trim();
          const isRealLink =
            href &&
            href !== "#" &&
            !href.startsWith("javascript:") &&
            !href.startsWith("mailto:");
          if (!isRealLink) return;

          const text = (a.textContent ?? "").trim();
          if (text) return; // has visible text — has a name

          // Check for img with non-empty alt
          const imgs = a.querySelectorAll("img");
          for (let i = 0; i < imgs.length; i++) {
            if ((imgs[i].getAttribute("alt") ?? "").trim()) return; // has name
          }

          origSetAttribute.call(a, "data-r11-no-name-ssr", "");
          (window as any).__r11SsrCount__.noName++;
        }
      }

      const ssrObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if ((node as Element).nodeType !== 1) continue;
            const el = node as Element;
            // The element itself may be the link
            if (el.tagName === "A") auditLinkSsr(el);
            // Or it may contain link descendants (common when a section is
            // added as a whole subtree by the HTML parser)
            for (const a of el.querySelectorAll("a")) {
              auditLinkSsr(a);
            }
          }
        }
      });
      // Observe `document` (not documentElement) — evaluateOnNewDocument runs
      // before the HTML parser creates any elements so documentElement is null.
      // Observing document itself with subtree:true captures every subsequent
      // mutation including the <html>/<body> creation and all descendants.
      ssrObserver.observe(document, {
        childList: true,
        subtree: true,
      });
    });

    logger.info({ url }, "Navigating to page");
    await onStage?.("navigating");
    let httpResponse: Awaited<ReturnType<typeof page.goto>> = null;
    let navigationTimedOut = false;
    let loadDurationMs: number | undefined;
    let rawHtml: string | undefined;

    if (options.preloadHtml) {
      // ── Crawl Boost: skip network navigation entirely ───────────────────────
      // Phase 1 already rendered this page with DOM stability wait and captured
      // the HTML. Use page.setContent() for instant, bot-protection-free loading.
      rawHtml = options.preloadHtml;
      const preloadUrl =
        options.preloadMetadata?.finalUrl &&
        options.preloadMetadata.finalUrl !== "about:blank"
          ? options.preloadMetadata.finalUrl
          : url;
      const setStart = Date.now();
      try {
        await page.setContent(preparePreloadedHtml(options.preloadHtml, preloadUrl), {
          waitUntil: "domcontentloaded",
          timeout,
        });
        loadDurationMs = Date.now() - setStart;
      } catch (err) {
        loadDurationMs = Date.now() - setStart;
        logger.warn(
          { url, err: String(err) },
          "Crawl Boost: setContent failed — page may still have usable DOM",
        );
      }
    } else {
      // ── Normal navigation path ───────────────────────────────────────────────
      // Always navigate to domcontentloaded first — networkidle2 can hang forever on
      // pages with persistent analytics/tracking (long-polling, SSE, etc.)
      // If navigation times out (e.g. a redirect loop, stuck resource, etc.) we do
      // NOT fail the page outright — instead we check whether the browser has a
      // usable DOM and, if so, continue scanning whatever loaded.  This prevents a
      // slow CDN asset or an infinite-loop redirect from taking out the entire URL.
      // Capture the raw (pre-JS) main-document response body for incremental-scan
      // hashing. A response listener (rather than the goto() return value) is used
      // because Cloudflare-challenged pages deliver the real document via a later
      // navigation after the challenge resolves — the last successful main-frame
      // document response wins.
      page.on("response", (resp) => {
        try {
          const req = resp.request();
          if (
            req.resourceType() === "document" &&
            req.frame() === page!.mainFrame() &&
            resp.status() >= 200 &&
            resp.status() < 300
          ) {
            resp
              .text()
              .then((body) => {
                const lower = body.slice(0, 4000).toLowerCase();
                if (
                  !lower.includes("just a moment") &&
                  !lower.includes("verifying your connection")
                ) {
                  rawHtml = body;
                }
              })
              .catch(() => {});
          }
        } catch {
          /* page may already be closed */
        }
      });
      const navStart = Date.now();
      // A slow origin, WAF challenge, or a page with a very large JS bundle can
      // miss the first DOMContentLoaded budget. Retry the same page with a
      // longer budget before declaring it unusable. This also avoids the
      // Runtime.callFunctionOn timeout seen when the first navigation is still
      // resolving while the scanner immediately evaluates the DOM.
      const navigationTimeouts = [
        Math.max(timeout, 30_000),
        Math.max(timeout * 2, 60_000),
        Math.max(timeout * 3, 90_000),
      ];
      let lastNavigationError: unknown;
      for (let attempt = 0; attempt < navigationTimeouts.length; attempt++) {
        try {
          httpResponse = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: navigationTimeouts[attempt],
          });
          lastNavigationError = undefined;
          break;
        } catch (navErr) {
          lastNavigationError = navErr;
          const msg = String(navErr).toLowerCase();
          const isTimeout = msg.includes("timeout") || msg.includes("timed out");
          const isAborted =
            msg.includes("aborted") || msg.includes("net::err_aborted");
          if (!isTimeout && !isAborted) throw navErr;
          logger.warn(
            { url, attempt: attempt + 1, timeoutMs: navigationTimeouts[attempt], err: String(navErr) },
            "Navigation timed out — retrying with longer budget",
          );
        }
      }
      loadDurationMs = Date.now() - navStart;
      if (lastNavigationError) {
        // Check whether the browser has a usable DOM only after all retries.
        const hasDOM = await page
          .evaluate(() => !!document.body?.innerHTML?.trim())
          .catch(() => false);
        if (!hasDOM) {
          return {
            url,
            issues: [],
            error: `Navigation did not load a usable page after ${navigationTimeouts.length} attempts: ${String(lastNavigationError)}`,
            loadDurationMs,
          };
        }
        navigationTimedOut = true;
        logger.info(
          { url, err: String(lastNavigationError) },
          "Navigation retries exhausted — continuing with partial DOM",
        );
      }
    }

    // Detect hard HTTP 4xx/5xx errors immediately (before any CF challenge handling).
    // 403 is intentionally excluded here — Cloudflare sometimes returns 403 instead of
    // a challenge page, so we let the stealth profile attempt a retry first.
    // (Skipped for crawl boost — preloadHtml means we already have a good page.)
    const staticPreflight = await staticPreflightPromise.catch(() => undefined);
    const httpStatus = options.preloadHtml
      ? options.preloadMetadata?.httpStatus
      : httpResponse?.status();
    const contentType = options.preloadHtml
      ? options.preloadMetadata?.contentType ?? undefined
      : httpResponse?.headers?.()["content-type"]?.split(";")[0]?.trim().toLowerCase();
    const responseCapturedAt = options.preloadHtml
      ? options.preloadMetadata?.responseCapturedAt ?? new Date()
      : staticPreflight?.capturedAt ?? new Date();
    const proxyStrategy = options.proxyPacUrl ? "configured_pac" : "direct";
    const baseHttpProvenance: PageHttpProvenance = options.preloadHtml && options.preloadMetadata
      ? {
          ...createCrawlerCaptureProvenance(url, options.preloadMetadata),
          proxyStrategy,
          rawHtmlHash: staticPreflight?.rawHtmlHash,
        }
      : {
          requestedUrl: redactProvenanceUrl(url),
          finalUrl: redactProvenanceUrl(page.url() || staticPreflight?.finalUrl || url),
          httpStatus,
          contentType,
          responseCapturedAt,
          acquisitionMethod: options.preloadHtml ? "crawler_capture" : "chromium",
          proxyStrategy,
          rawHtmlHash: staticPreflight?.rawHtmlHash,
        };
    if (
      !options.preloadHtml &&
      httpStatus != null &&
      (httpStatus === 404 || httpStatus === 410 || httpStatus >= 500)
    ) {
      logger.info(
        { url, httpStatus },
        "HTTP error status — marking page as not available",
      );
      return {
        url,
        issues: [],
        notAvailable: true,
        error: `HTTP ${httpStatus} – Page Not Available`,
          httpStatus,
          staticPreflight,
          httpProvenance: baseHttpProvenance,
      };
    }
    const wasBlocked403 = !options.preloadHtml && httpStatus === 403;

    await onStage?.("rendering");

    // Cloudflare Bot Management shows a challenge page before redirecting to the real page.
    // Detect it and wait up to 25s for the JS challenge to complete and the real page to load.
    // Skipped in crawl boost mode — page.setContent() never serves a CF challenge.
    const isCfChallenge =
      !options.preloadHtml &&
      (await page.evaluate((): boolean => {
        const title = document.title.toLowerCase();
        const bodyText = document.body?.innerText?.toLowerCase() ?? "";
        return (
          title.includes("just a moment") ||
          title.includes("please wait") ||
          title.includes("checking your browser") ||
          bodyText.includes("verifying your connection") ||
          bodyText.includes("checking your browser before accessing") ||
          bodyText.includes("enable javascript and cookies") ||
          !!document.querySelector(
            "#challenge-form, #cf-challenge-running, .cf-browser-verification, [id^='challenge-']",
          )
        );
      }));

    if (isCfChallenge) {
      logger.info(
        { url },
        "Cloudflare challenge detected — waiting for it to resolve (up to 55s)",
      );
      // Phase 1: wait up to 30s for the JS challenge to execute and redirect
      try {
        await Promise.race([
          page.waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 20000,
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 30000)),
        ]);
      } catch {
        /* expected if no navigation fires within 30s */
      }

      // Re-check: are we still on the challenge page?
      const stillOnChallenge = await page.evaluate((): boolean => {
        const title = document.title.toLowerCase();
        const bodyText = document.body?.innerText?.toLowerCase() ?? "";
        return (
          title.includes("just a moment") ||
          title.includes("please wait") ||
          title.includes("checking your browser") ||
          bodyText.includes("verifying your connection") ||
          bodyText.includes("checking your browser before accessing") ||
          bodyText.includes("enable javascript and cookies") ||
          !!document.querySelector(
            "#challenge-form, #cf-challenge-running, .cf-browser-verification, [id^='challenge-']",
          )
        );
      });

      if (stillOnChallenge) {
        // Phase 2: give it another 25s
        logger.info(
          { url },
          "Still on Cloudflare challenge — waiting an additional 25s",
        );
        try {
          await Promise.race([
            page.waitForNavigation({
              waitUntil: "domcontentloaded",
              timeout: 15000,
            }),
            new Promise<void>((resolve) => setTimeout(resolve, 25000)),
          ]);
        } catch {
          /* expected */
        }

        // Final check: if STILL on challenge, abort — don't scan the bot-wall
        const finalChallenge = await page.evaluate((): boolean => {
          const title = document.title.toLowerCase();
          const bodyText = document.body?.innerText?.toLowerCase() ?? "";
          return (
            title.includes("just a moment") ||
            title.includes("please wait") ||
            title.includes("checking your browser") ||
            bodyText.includes("verifying your connection") ||
            bodyText.includes("checking your browser before accessing") ||
            bodyText.includes("enable javascript and cookies") ||
            bodyText.includes("performing security verification") ||
            !!document.querySelector(
              "#challenge-form, #cf-challenge-running, .cf-browser-verification, [id^='challenge-']",
            )
          );
        });
        if (finalChallenge) {
          throw new Error(
            "Cloudflare Bot Protection blocked the scan — the page could not be reached. Try scanning from a browser with the cf_clearance cookie already set.",
          );
        }
      }

      // Extra pause for any post-redirect JS to settle
      await new Promise((r) => setTimeout(r, 2000));
      logger.info(
        { url, currentUrl: page.url() },
        "Cloudflare challenge resolved",
      );
    }

    // If the initial response was 403 and no CF challenge was visible, retry once.
    // Some WAFs (Cloudflare, Akamai, Imperva) return 403 on first contact; a second
    // attempt with cleared cookies, a fresh Referer, and updated UA sometimes gets through.
    if (wasBlocked403 && !isCfChallenge) {
      logger.info(
        { url },
        "Initial 403 with no CF challenge — clearing cookies and retrying",
      );
      let retryStatus = 403;
      try {
        // Clear cookies so session-based blocks don't persist into the retry
        const client = await page.target().createCDPSession();
        await client.send("Network.clearBrowserCookies");
        await client.detach();
        // Add a Referer that looks like the user clicked a link from a search engine
        const urlObj = new URL(url);
        await page.setExtraHTTPHeaders({
          "Accept-Language": "en-US,en;q=0.9",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Sec-Ch-Ua":
            '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
          "Sec-Ch-Ua-Mobile": "?0",
          "Sec-Ch-Ua-Platform": '"Windows"',
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "cross-site",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
          "Cache-Control": "no-cache",
          Referer: `https://www.google.com/search?q=${encodeURIComponent(urlObj.hostname)}`,
        });
        // Brief pause before retry so it doesn't look like an instant bot retry
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
        const retryResponse = await page.reload({
          waitUntil: "domcontentloaded",
          timeout,
        });
        retryStatus = retryResponse?.status() ?? 200;
      } catch {
        /* timeout or navigation error — treat as still blocked */
      }
      if (
        retryStatus === 403 ||
        retryStatus === 404 ||
        retryStatus === 410 ||
        retryStatus >= 500
      ) {
        // If a system proxy is configured and we're not already using it, retry via proxy browser.
        // This lets the scan succeed even when the server's datacenter IP is blocklisted by the WAF.
        if (options.fallbackProxyPacUrl && !options.proxyPacUrl) {
          logger.info(
            { url, retryStatus, proxyPacUrl: options.fallbackProxyPacUrl },
            "Still blocked after direct retry — re-running scan via system proxy",
          );
          const proxyResult = await _scanPageInternal(url, {
            ...options,
            proxyPacUrl: options.fallbackProxyPacUrl,
            fallbackProxyPacUrl: undefined, // prevent infinite recursion
          });
          // Tag proxy-level network failures so the queue can skip the broken proxy on retries
          if (proxyResult.error && isProxyNetworkError(proxyResult.error)) {
            logger.warn(
              {
                url,
                proxyUrl: options.fallbackProxyPacUrl,
                error: proxyResult.error,
              },
              "Proxy network error — proxy may not support HTTPS CONNECT tunneling",
            );
            return {
              ...proxyResult,
              error: `[proxy_failure] ${proxyResult.error} — proxy may not support HTTPS (try a SOCKS4/5 proxy instead)`,
            };
          }
          return proxyResult;
        }
        logger.info(
          { url, retryStatus },
          "Still blocked after retry — marking page as WAF blocked",
        );
        return {
          url,
          issues: [],
          notAvailable: true,
          wafBlocked: true,
          error: `HTTP 403 – Access Denied by WAF/Firewall`,
        };
      }
      logger.info(
        { url, retryStatus },
        "Retry succeeded — continuing with scan",
      );
    }

    // Detect "page not available" content returned with a 200 status
    // (common on enterprise sites that have their own custom 404 pages)
    // Only check the page <title> and the first <h1> — checking full body text
    // causes false positives when nav/footer menus mention these phrases.
    const isContentNotAvailable = await page.evaluate((): boolean => {
      const title = document.title.toLowerCase();
      const h1 =
        (
          document.querySelector("h1") as HTMLElement | null
        )?.innerText?.toLowerCase() ?? "";
      const checks = [
        "that page is not available",
        "page is not available",
        "page not available",
        "this page is not available",
        "page cannot be found",
        "page could not be found",
        "page doesn't exist",
        "page does not exist",
        "404 not found",
        "error 404",
        "404 – not found",
        "404 - not found",
      ];
      return checks.some(
        (phrase) => title.includes(phrase) || h1.includes(phrase),
      );
    });

    if (isContentNotAvailable) {
      logger.info(
        { url },
        "Page content indicates 'not available' — skipping scan",
      );
      return {
        url,
        issues: [],
        notAvailable: true,
        error: "Page Not Available",
      };
    }

    // Confirm DOMContentLoaded state — HTML parsed, initial DOM built.
    // We scan this initial state without waiting for window.load or JS mutations,
    // so accessibility issues are reported on what the server actually sent.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          if (
            document.readyState === "interactive" ||
            document.readyState === "complete"
          )
            return resolve();
          document.addEventListener("DOMContentLoaded", () => resolve(), {
            once: true,
          });
          setTimeout(resolve, 5000);
        }),
    );

    // Detect and follow client-side redirects.
    // CMS/AEM platforms (and some SPA routers) serve an intermediate page with placeholder
    // attributes — e.g. lang="en-SOFTWAREVERSIONREDIRECT" or lang="clienlibs-KEYSIGHT" —
    // then redirect to the real content via <meta http-equiv="refresh"> or window.location.
    // Scanning the intermediate DOM produces false positives from placeholder content.
    // We detect redirect indicators and, if found, wait for the navigation to complete
    // then re-apply the full DOMContentLoaded → load → MutationObserver settle sequence
    // on the final page so the scanner always runs against the real content.
    const redirectInfo = await page
      .evaluate(
        (): { hasMetaRefresh: boolean; invalidLang: boolean; lang: string } => {
          const lang = (
            document.documentElement.getAttribute("lang") ?? ""
          ).trim();
          const hasMetaRefresh = !!document.querySelector(
            'meta[http-equiv="refresh"]',
          );
          // Use Intl.getCanonicalLocales() to validate BCP 47 — it throws RangeError for any
          // invalid tag (e.g. "en-SOFTWAREVERSIONREDIRECT", "clienlibs-KEYSIGHT").
          // An invalid lang attribute on the <html> element is a reliable signal that the page
          // is still in an intermediate CMS/AEM state and a client-side redirect is pending.
          let invalidLang = false;
          if (lang.length > 0) {
            try {
              Intl.getCanonicalLocales(lang);
            } catch {
              invalidLang = true;
            }
          }
          return { hasMetaRefresh, invalidLang, lang };
        },
      )
      .catch(() => ({ hasMetaRefresh: false, invalidLang: false, lang: "" }));

    if (redirectInfo.hasMetaRefresh || redirectInfo.invalidLang) {
      logger.info(
        { url, redirectInfo },
        "Intermediate/redirect page detected — waiting for final navigation (up to 15s)",
      );
      try {
        await page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        const finalUrl = page.url();
        logger.info(
          { url, finalUrl },
          "Client-side redirect followed — re-settling final page",
        );
        // Confirm DOMContentLoaded on the final page
        await page
          .evaluate(
            () =>
              new Promise<void>((resolve) => {
                if (
                  document.readyState === "interactive" ||
                  document.readyState === "complete"
                )
                  return resolve();
                document.addEventListener("DOMContentLoaded", () => resolve(), {
                  once: true,
                });
                setTimeout(resolve, 5000);
              }),
          )
          .catch(() => {});
      } catch {
        logger.info(
          { url },
          "Redirect navigation did not complete within 15s — scanning current page state",
        );
      }
    }

    // Pre-stability R11 snapshot — capture zero-accessible-name links at the
    // DOMContentLoaded state, BEFORE the 1-second DOM stability wait fires.
    //
    // At this point the HTML is parsed (inline + defer scripts have run) but most
    // async scripts (AEM data-value → aria-label injectors, text-content injectors)
    // have NOT run yet.  This is approximately the state Siteimprove scans at,
    // which is why they find links with no accessible name that our post-stability
    // scan misses (by that point JS has already fixed the links).
    //
    // We store the no-name hrefs in window.__r11PreStabilityNoName__ so the R11
    // rule (inside the big page.evaluate) can read them without any extra args.
    try {
      await page.evaluate(() => {
        const noNameHrefs = new Set<string>();
        document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
          if (a.getAttribute("aria-hidden") === "true") return;
          const role = a.getAttribute("role");
          if (role === "presentation" || role === "none") return;
          const href = (a.getAttribute("href") ?? "").trim();
          if (!href || href === "#" || href.startsWith("javascript:")) return;

          // Check accessible name from DOM attributes (no CSS — too expensive)
          const al = (a.getAttribute("aria-label") ?? "").trim();
          if (al) return;
          if (a.getAttribute("aria-labelledby")) return; // assume it resolves
          const t = (a.getAttribute("title") ?? "").trim();
          if (t) return;
          const txt = (a.textContent ?? "").trim();
          if (txt) return;
          const imgs = a.querySelectorAll("img");
          for (let i = 0; i < imgs.length; i++) {
            if ((imgs[i].getAttribute("alt") ?? "").trim()) return;
          }
          noNameHrefs.add(href);
        });
        (window as any).__r11PreStabilityNoName__ = noNameHrefs;
        (window as any).__r11PreStabilityCount__ = noNameHrefs.size;
      });
    } catch (snapErr) {
      logger.warn({ url, err: snapErr }, "R11 pre-stability snapshot failed");
    }

    // Phase 1 — DOM stability wait.
    //
    // After DOMContentLoaded the HTML is parsed, but JS frameworks (React, Angular,
    // AEM etc.) still need time to mount their initial components and inject links,
    // images, and other content into the DOM.  Scanning at the literal DCL instant
    // means those elements don't exist yet, so rules like R11/R12 find nothing.
    //
    // We wait until DOM mutations have been quiet for DOM_QUIET_MS (300 ms),
    // capped at DOM_STABILITY_CAP_MS (1 s).  This fires BEFORE any post-load
    // setTimeout / requestAnimationFrame accessibility patches (which typically
    // run several seconds after load on SSR/AEM pages), matching Siteimprove's
    // effective scan point.  For SPAs, 1 s is enough for the framework to mount
    // its initial render.  Reducing from 4 s → 1 s ensures aria-label injection
    // scripts (which load after 4+ s on e.g. Keysight) haven't run yet.
    const DOM_QUIET_MS = 300;
    const DOM_STABILITY_CAP_MS = 1000;
    const domStabilityMs = await page
      .evaluate(
        ({ quietMs, capMs }: { quietMs: number; capMs: number }) =>
          new Promise<number>((resolve) => {
            const start = Date.now();
            let quietTimer: ReturnType<typeof setTimeout> | null = null;

            function settle() {
              if (quietTimer) clearTimeout(quietTimer);
              quietTimer = setTimeout(() => {
                observer.disconnect();
                resolve(Date.now() - start);
              }, quietMs);
            }

            const observer = new MutationObserver(settle);
            observer.observe(document.documentElement, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: false,
            });

            // Start the quiet timer immediately — resolves at once if DOM is already stable.
            settle();

            // Hard cap: never block more than capMs.
            setTimeout(() => {
              observer.disconnect();
              if (quietTimer) clearTimeout(quietTimer);
              resolve(Date.now() - start);
            }, capMs);
          }),
        { quietMs: DOM_QUIET_MS, capMs: DOM_STABILITY_CAP_MS },
      )
      .catch(() => 0);
    logger.info({ url, domStabilityMs }, "DOM stability settled");

    // Phase 2 — optional additional delay on top of the stable baseline.
    //
    // scanDelayMs = 10_000 (default): wait after the stable initial-render point.
    //   Issues patched by post-load JS (setTimeout, rAF) are still visible here —
    //   this matches Siteimprove's scan point.
    //
    // scanDelayMs > 0: wait this many extra milliseconds after stability settles.
    //   More JS runs during this time (aria-label injections, lazy-load fixes).
    //   Use only when you intentionally want to capture a later DOM state.
    if (scanDelayMs > 0) {
      logger.info(
        { url, scanDelayMs },
        "Scan delay — waiting before accessibility checks",
      );
      await new Promise<void>((resolve) => setTimeout(resolve, scanDelayMs));
    }

    // Keep the HTML evidence at the exact DOM state used by the accessibility
    // rules. The visual snapshot is intentionally captured later, after
    // resources and late layout changes settle, so its highlights line up with
    // the final rendered page.
    let screenshot: string | undefined;
    let pageHtml: string | undefined;
    let interactionStates: InteractionStateEvidence[] = [];

    // Capture the rendered DOM immediately before rule execution. Do not move
    // this after the rules or the later visual-readiness wait: pages can patch
    // aria-labels and other accessibility attributes asynchronously, which
    // would make the displayed HTML disagree with the state that produced an
    // issue.
    try {
      pageHtml = await captureReplayHtml(page, replayStylesheets);
      logger.info(
        { url, sizeKb: Math.round(pageHtml.length / 1024) },
        "Rule-time page HTML captured",
      );
    } catch (htmlErr) {
      logger.warn(
        { url, err: htmlErr },
        "Failed to capture rule-time page HTML — continuing without it",
      );
    }

    logger.info(
      { url },
      "Running ACT accessibility rules on rule-time DOM",
    );
    await onStage?.("analyzing");
    // Media requests stay blocked during navigation so large videos cannot
    // delay or exhaust a scan. Briefly allow metadata loading here so media
    // rules can inspect decoded audio tracks instead of treating every
    // video/* container as unknown. Restore author-provided preload attributes
    // so this scanner-only preparation does not alter captured issue markup.
    allowMediaMetadata = true;
    try {
      await page.evaluate(async () => {
        const videos = Array.from(document.querySelectorAll("video"));
        await Promise.all(videos.map(async (video) => {
          if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return;
          const originalPreload = video.getAttribute("preload");
          try {
            video.preload = "metadata";
            video.load();
            await new Promise<void>((resolve) => {
              const finish = () => resolve();
              video.addEventListener("loadedmetadata", finish, { once: true });
              video.addEventListener("error", finish, { once: true });
              window.setTimeout(finish, 5000);
            });
          } finally {
            if (originalPreload === null) video.removeAttribute("preload");
            else video.setAttribute("preload", originalPreload);
          }
        }));
      });
    } finally {
      allowMediaMetadata = false;
    }
    const actResult = await runACTRules(page, options.rules);
    let issues = actResult.issues;
    const ruleStats = actResult.stats;
    logger.info({ url, issueCount: issues.length }, "ACT rules completed");
    issues = issues.map((issue) => {
      const wcag = WCAG_MAPPING[issue.ruleId];

      return {
        ...issue,
        wcagCriteria: wcag?.sc?.join(", ") || null,
        wcagLevel: wcag?.level?.join(", ") || null,

        // ✅ THIS IS WHAT YOU WANT
        legal: getLegalCompliance(wcag?.level || []),
      };
    });
    // If a rule filter was specified, only return issues matching those rule IDs
    if (options.rules && options.rules.length > 0) {
      const ruleSet = getSelectedRuleIds(options.rules);
      issues = issues.filter((i) => isRuleSelected(i.ruleId, ruleSet));
    }

    // Safely reveal common non-navigating UI states and run the same complete
    // rule bundle against each one. Findings from a revealed state replace an
    // identical baseline finding so its bbox and snapshot match visible UI.
    try {
      const triggers = await discoverSafeInteractionTriggers(page);
      if (triggers.length > 0) {
        allowVisualImages = true;
        await hydrateVisualImages(page).catch(() => 0);
        const explored = await exploreInteractiveStates(
          page,
          triggers,
          replayStylesheets,
          options.rules,
        );
        for (const stateIssue of explored.issues) {
          const key = `${stateIssue.ruleId}|${stateIssue.selector ?? ""}|${stateIssue.description}`;
          issues = issues.filter(
            (existing) =>
              `${existing.ruleId}|${existing.selector ?? ""}|${existing.description}` !== key,
          );
          issues.push(stateIssue);
        }
        ruleStats.push(...explored.stats);
        const usedStateKeys = new Set(
          issues
            .map((issue) => issue.interactionStateKey)
            .filter((key): key is string => !!key),
        );
        interactionStates = explored.states.filter((state) =>
          usedStateKeys.has(state.key),
        );
        logger.info(
          {
            url,
            triggers: triggers.length,
            states: interactionStates.length,
            stateIssues: explored.issues.length,
          },
          "Interactive page states scanned",
        );
      }
    } catch (interactionErr) {
      logger.warn(
        { url, err: interactionErr },
        "Interactive-state exploration failed — continuing with baseline state",
      );
    }

    // Capture the final visual snapshot only when the page has issues. Clean
    // pages skip the 1–3 s full-page screenshot and the heavy snapshot write.
    if (issues.length > 0) {
      // Keep the fast rule-scanning flow intact. Only issue pages enter this
      // visual pass, where image requests are allowed and previously blocked
      // image/background assets are explicitly retried.
      allowVisualImages = true;
      try {
        const hydrated = await hydrateVisualImages(page);
        logger.info({ url, hydrated }, "Visual image hydration requested");
      } catch (hydrateErr) {
        logger.warn(
          { url, err: hydrateErr },
          "Visual image hydration failed — capturing available rendered page",
        );
      }

      // The visual snapshot represents the final rendered layout rather than
      // the rule-time DOM. This is deliberately after rule execution so late
      // CSS, images, fonts, and JS layout changes are reflected in the image.
      try {
        const visualReady = await page.evaluate(async () => {
          const startedAt = Date.now();
          const timeoutMs = 10_000;
          const getState = () => {
            const images = Array.from(document.images);
            const stylesheets = Array.from(
              document.querySelectorAll<HTMLLinkElement>(
                'link[rel~="stylesheet"]',
              ),
            );
            return {
              images,
              stylesheets,
              pendingImages: images.filter((img) => !img.complete),
              pendingStylesheets: stylesheets.filter((link) => !link.sheet),
            };
          };

          // Poll the current state rather than relying only on load listeners:
          // resources can finish between navigation and this check.
          while (Date.now() - startedAt < timeoutMs) {
            const state = getState();
            const fontsLoaded =
              !document.fonts || document.fonts.status === "loaded";
            if (
              state.pendingImages.length === 0 &&
              state.pendingStylesheets.length === 0 &&
              fontsLoaded
            )
              break;
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
          }

          // Give layout one animation frame after the last resource resolves so
          // image dimensions, web fonts, and lazy CSS have been applied.
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );

          const finalState = getState();
          return {
            images: finalState.images.length,
              pendingImages: finalState.images.filter(
                (img) =>
                  !img.complete ||
                  (!!(img.currentSrc || img.getAttribute("src")) &&
                    img.naturalWidth === 0),
              ).length,
            stylesheets: finalState.stylesheets.length,
            pendingStylesheets: finalState.pendingStylesheets.length,
            fontsReady: document.fonts?.status === "loaded",
            timedOut: Date.now() - startedAt >= timeoutMs,
          };
        });
        logger.info(
          { url, visualReady },
          "Visual resources settled before snapshot",
        );
      } catch (visualErr) {
        logger.warn(
          { url, err: visualErr },
          "Visual readiness wait failed — capturing available rendered page",
        );
      }

      // ── 1. Final-layout bounding boxes for snapshot highlights ─────────
      if (issues.length > 0) {
        const bboxes = await page.evaluate(
          (selectors: (string | null)[]) => {
            const isSnapshotVisible = (candidate: Element): boolean => {
              let current: Element | null = candidate;
              while (current) {
                const style = window.getComputedStyle(current);
                if (
                  style.display === "none" ||
                  style.visibility === "hidden" ||
                  style.visibility === "collapse" ||
                  Number.parseFloat(style.opacity) === 0
                ) {
                  return false;
                }
                current = current.parentElement;
              }
              const rect = candidate.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            };

            return selectors.map((sel) => {
              if (!sel) return null;
              try {
                const el = document.querySelector(sel);
                if (!el) return null;

                let snapshotTarget = el;
                if (!isSnapshotVisible(snapshotTarget)) {
                  let ancestor = snapshotTarget.parentElement;
                  while (ancestor && ancestor !== document.body) {
                    if (isSnapshotVisible(ancestor)) {
                      const ancestorRect = ancestor.getBoundingClientRect();
                      const viewportArea = Math.max(
                        1,
                        window.innerWidth * window.innerHeight,
                      );
                      // A compact visible disclosure/menu wrapper gives useful
                      // context for a dormant control. A page-sized ancestor
                      // would be a misleading highlight, so omit it.
                      if (
                        ancestorRect.width * ancestorRect.height <=
                        viewportArea * 0.35
                      ) {
                        snapshotTarget = ancestor;
                      } else {
                        return null;
                      }
                      break;
                    }
                    ancestor = ancestor.parentElement;
                  }
                  if (!ancestor || ancestor === document.body) return null;
                }

                const rect = snapshotTarget.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return null;
                return {
                  x: Math.round(rect.left + window.scrollX),
                  y: Math.round(rect.top + window.scrollY),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                };
              } catch {
                return null;
              }
            });
          },
          issues.map((i) => i.selector),
        );

        issues = issues.map((issue, idx) => ({
          ...issue,
          bboxX: bboxes[idx]?.x ?? null,
          bboxY: bboxes[idx]?.y ?? null,
          bboxWidth: bboxes[idx]?.width ?? null,
          bboxHeight: bboxes[idx]?.height ?? null,
        }));
        logger.info(
          { url, withBbox: bboxes.filter(Boolean).length },
          "Final-layout bounding boxes captured",
        );
      }

      // ── 1b. Pixel-contrast pass — resolve url()-background elements ────
      // Elements whose background is a CSS image (url()) were classified as
      // "indeterminate" by the DOM rule and optionally emitted as Potential
      // Issues.  This pass takes a single full-page PNG, samples the rendered
      // pixel colours at each candidate's bounding box, and emits confirmed
      // Issues for elements whose actual contrast fails the WCAG threshold.
      try {
        const PIXEL_RULE_IDS = new Set(["ACT-R69", "ACT-R66", "ACT-R88", "ACT-R89"]);
        const selectedRuleSet = getSelectedRuleIds(options.rules);
        const shouldRunPixelContrast =
          selectedRuleSet === null ||
          Array.from(PIXEL_RULE_IDS).some((ruleId) => isRuleSelected(ruleId, selectedRuleSet));
        const pixelIssues = shouldRunPixelContrast
          ? (await runPixelContrastPass(page, logger)).filter(
              (issue) =>
                isRuleSelected(issue.ruleId, selectedRuleSet),
            )
          : [];
        if (pixelIssues.length > 0) {
          // Remove Potential Issue stubs for the same selectors — the pixel
          // pass either promotes them to confirmed or dismisses them.
          const pixelSelectors = new Set(pixelIssues.map((pi) => pi.selector));
          issues = issues.filter(
            (issue) =>
              !(
                PIXEL_RULE_IDS.has(issue.ruleId) &&
                issue.type === "Potential Issue" &&
                issue.selector != null &&
                pixelSelectors.has(issue.selector)
              ),
          );

          // Merge pixel issues as confirmed Issues, enriched with WCAG metadata.
          for (const pi of pixelIssues) {
            const wcag = WCAG_MAPPING[pi.ruleId];
            const desc = RULE_DESCRIPTIONS[pi.ruleId];
            issues.push({
              ruleId: pi.ruleId,
              type: "Issue",
              impact: pi.impact,
              description: pi.description,
              element: null,
              elementContext: null,
              selector: pi.selector,
              remediation: desc?.remediation ?? null,
              wcagCriteria: wcag?.sc?.join(", ") || null,
              wcagLevel: wcag?.level?.join(", ") || null,
              legal: getLegalCompliance(wcag?.level || []),
              bboxX: pi.bboxX,
              bboxY: pi.bboxY,
              bboxWidth: pi.bboxW,
              bboxHeight: pi.bboxH,
              falsePositive: false,
            });
          }
          logger.info(
            { url, pixelIssues: pixelIssues.length },
            "Pixel contrast pass added confirmed issues",
          );
        }
      } catch (pixelErr) {
        logger.warn({ url, err: pixelErr }, "Pixel contrast pass failed — continuing without it");
      }

      // ── 2. Full-page screenshot with fallback to viewport-only ─────────
      try {
        const snapshotLayout = await expandPageScrollerForSnapshot(page);
        // Wrap in a timeout so a hung compositor doesn't block the slot forever
        const ssTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("screenshot timeout")), 30_000),
        );
        let screenshotBuffer: Uint8Array;
        try {
          screenshotBuffer = await Promise.race([
            page.screenshot({ type: "jpeg", quality: 40, fullPage: true }),
            ssTimeout,
          ]);
        } finally {
          await restoreSnapshotLayout(page, snapshotLayout).catch(() => {});
        }
        screenshot = Buffer.from(screenshotBuffer).toString("base64");
        logger.info(
          {
            url,
            sizeKb: Math.round(screenshotBuffer.length / 1024),
            expandedPageScroller: snapshotLayout.length > 0,
          },
          "Page snapshot captured (full-page)",
        );
      } catch (ssErr) {
        logger.warn(
          { url, err: ssErr },
          "Full-page screenshot failed — trying viewport-only fallback",
        );
        // Viewport-only fallback: avoids the compositor OOM that kills full-page on tall pages
        try {
          const fallbackBuf = await page.screenshot({
            type: "jpeg",
            quality: 40,
            fullPage: false,
          });
          screenshot = Buffer.from(fallbackBuf).toString("base64");
          logger.info(
            { url, sizeKb: Math.round(fallbackBuf.length / 1024) },
            "Page snapshot captured (viewport fallback)",
          );
        } catch (fallbackErr) {
          logger.warn(
            { url, err: fallbackErr },
            "Viewport fallback screenshot also failed — no snapshot stored",
          );
        }
      }
    } else {
      logger.info({ url }, "No issues — skipping snapshot and HTML capture");
    }

    // Extract QA metadata and link graph from the fully-rendered DOM
    let pageMeta: QAPageMeta | undefined;
    let links: QALink[] | undefined;
    let images: QAImage[] | undefined;
    try {
      const qaData = await page.evaluate((pageUrl: string) => {
        let baseOrigin = "";
        try {
          baseOrigin = new URL(pageUrl).origin;
        } catch {
          /**/
        }

        // Page metadata
        const title = (document.title ?? "").trim() || undefined;
        const h1El = document.querySelector("h1") as HTMLElement | null;
        const h1 = h1El
          ? (h1El.innerText ?? "").trim().slice(0, 500) || undefined
          : undefined;
        const metaEl = document.querySelector(
          'meta[name="description"]',
        ) as HTMLMetaElement | null;
        const metaDescription = metaEl
          ? (metaEl.content ?? "").trim().slice(0, 500) || undefined
          : undefined;
        const lastModified = document.lastModified || undefined;
        const bodyText = (document.body?.innerText ?? "").trim();
        const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

        // Link extraction — include all link types for QA inventory (mailto:, tel:, doc, css, js, media)
        const seen = new Set<string>();
        const rawLinks: Array<{
          href: string;
          anchorText: string;
          linkType: string;
        }> = [];
        const anchors = document.querySelectorAll("a[href]");
        for (let i = 0; i < anchors.length && rawLinks.length < 500; i++) {
          const el = anchors[i] as HTMLAnchorElement;
          const raw = el.getAttribute("href") ?? "";
          if (!raw || raw.startsWith("#") || raw.startsWith("data:")) continue;

          let href = raw;
          let linkType = "internal";

          if (raw.startsWith("mailto:")) {
            linkType = "email";
          } else if (raw.startsWith("tel:")) {
            linkType = "phone";
          } else if (raw.startsWith("javascript:")) {
            continue;
          } else {
            try {
              const resolved = new URL(raw, pageUrl).href;
              href = resolved.split("#")[0];
            } catch {
              continue;
            }
            try {
              const u = new URL(href);
              const p = u.pathname.toLowerCase();
              if (u.origin !== baseOrigin) linkType = "external";
              if (p.endsWith(".pdf")) linkType = "pdf";
              else if (p.match(/\.(docx?|xlsx?|pptx?|odt|ods|rtf|csv)$/))
                linkType = "document";
              else if (p.endsWith(".js")) linkType = "javascript";
              else if (p.endsWith(".css")) linkType = "css";
              else if (
                p.match(
                  /\.(jpe?g|png|gif|webp|svg|bmp|ico|avif|mp4|webm|avi|mp3|wav|ogg)$/,
                )
              )
                linkType = "media";
            } catch {
              /**/
            }
          }

          if (seen.has(href)) continue;
          seen.add(href);

          const anchorText = (
            (el.innerText ?? "") ||
            (el.getAttribute("aria-label") ?? "")
          )
            .trim()
            .slice(0, 300);
          rawLinks.push({ href, anchorText, linkType });
        }

        // Image extraction for QA image inventory
        const rawImages: Array<{
          src: string;
          alt: string;
          width: number;
          height: number;
          isExternal: boolean;
        }> = [];
        const imgEls = document.querySelectorAll("img[src]");
        for (let i = 0; i < imgEls.length && rawImages.length < 300; i++) {
          const img = imgEls[i] as HTMLImageElement;
          const rawSrc = img.getAttribute("src") ?? "";
          if (!rawSrc || rawSrc.startsWith("data:")) continue;
          let resolvedSrc = "";
          try {
            resolvedSrc = new URL(rawSrc, pageUrl).href;
          } catch {
            continue;
          }
          const imgAlt = (img.getAttribute("alt") ?? "").trim();
          let isExternal = false;
          try {
            isExternal = new URL(resolvedSrc).origin !== baseOrigin;
          } catch {
            /**/
          }
          rawImages.push({
            src: resolvedSrc,
            alt: imgAlt,
            width: img.naturalWidth || img.width || 0,
            height: img.naturalHeight || img.height || 0,
            isExternal,
          });
        }

        return {
          title,
          h1,
          metaDescription,
          wordCount,
          lastModified,
          bodyText: bodyText.slice(0, 10000),
          links: rawLinks,
          images: rawImages,
        };
      }, url);

      pageMeta = {
        title: qaData.title,
        h1: qaData.h1,
        metaDescription: qaData.metaDescription,
        wordCount: qaData.wordCount,
        lastModified: qaData.lastModified,
        bodyText: qaData.bodyText,
      };
      links = qaData.links as QALink[];
      images = qaData.images as QAImage[];
    } catch (qaErr) {
      logger.warn(
        { url, err: String(qaErr) },
        "QA metadata/link extraction failed — skipping",
      );
    }

    return {
      url,
      issues,
      screenshot,
      pageHtml,
      loadDurationMs,
      httpStatus,
      httpProvenance: {
        ...baseHttpProvenance,
        finalUrl: options.preloadHtml
          ? baseHttpProvenance.finalUrl
          : redactProvenanceUrl(page.url() || url),
        rawHtmlHash: rawHtml ? hashPreflightHtml(rawHtml) : staticPreflight?.rawHtmlHash,
        renderedDomHash: pageHtml ? hashRenderedDom(pageHtml) : undefined,
      },
      staticPreflight,
      pageMeta,
      links,
      images,
      rawHtml,
      ruleStats,
      ruleStatuses: actResult.ruleStatuses,
      interactionStates,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const timeoutMatch = msg.match(/Navigation timeout of (\d+) ms exceeded/);
    if (timeoutMatch) {
      const seconds = Math.round(parseInt(timeoutMatch[1], 10) / 1000);
      const normalised = `Scan timed out after ${seconds}s while loading the page.`;
      logger.warn({ url, error: normalised }, "Failed to scan page");
      return { url, issues: [], error: normalised };
    }
    logger.warn({ url, error: msg }, "Failed to scan page");
    return { url, issues: [], error: msg };
  } finally {
    // Always clean up the abort listener to avoid memory leaks
    if (abortHandler && options.signal) {
      options.signal.removeEventListener("abort", abortHandler);
    }
    if (page) {
      await page.close().catch(() => {});
    }
  }
}
function getLegalCompliance(levels: string[] = []) {
  const isApplicable = levels.includes("A") || levels.includes("AA");

  return {
    ada: isApplicable ? ["Title II"] : [],
    eaa: isApplicable,
  };
}

interface SafeInteractionTrigger {
  selector: string;
  label: string;
}

async function discoverSafeInteractionTriggers(
  page: Page,
): Promise<SafeInteractionTrigger[]> {
  return page.evaluate(() => {
    const unsafeAction =
      /\b(delete|remove|purchase|buy|checkout|pay|place order|submit|save|send|upload|sign out|log out|unsubscribe)\b/i;
    const isVisible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.visibility !== "collapse" &&
        Number.parseFloat(style.opacity) > 0
      );
    };
    const selectorFor = (el: Element): string => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts: string[] = [];
      let current: Element | null = el;
      while (current && current !== document.body && parts.length < 6) {
        let part = current.tagName.toLowerCase();
        const parentEl: Element | null = current.parentElement;
        if (parentEl) {
          const siblings: Element[] = Array.from(parentEl.children).filter(
            (sibling: Element) => sibling.tagName === current!.tagName,
          );
          if (siblings.length > 1) {
            part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
          }
        }
        parts.unshift(part);
        current = parentEl;
      }
      return parts.join(" > ");
    };

    const candidates = Array.from(
      document.querySelectorAll(
        "summary,button,[role='button'],[aria-expanded='false'],[aria-haspopup]:not([aria-haspopup='false']),[aria-controls],[data-toggle='modal'],[data-toggle='dropdown'],[data-toggle='collapse'],a[href]",
      ),
    );
    const seen = new Set<string>();
    const result: SafeInteractionTrigger[] = [];

    for (const el of candidates) {
      if (result.length >= 12 || !isVisible(el)) continue;
      if (
        el.closest("[hidden],[inert],[aria-hidden='true']") ||
        el.getAttribute("aria-disabled") === "true" ||
        (el as HTMLButtonElement).disabled
      ) {
        continue;
      }
      const button = el as HTMLButtonElement;
      if (button.tagName === "BUTTON" && (button.type === "submit" || button.type === "reset")) {
        continue;
      }
      if (el.tagName === "A") {
        const href = (el.getAttribute("href") ?? "").trim();
        if (href && href !== "#" && !href.startsWith("#")) {
          try {
            const target = new URL(href, location.href);
            const current = new URL(location.href);
            if (
              target.origin !== current.origin ||
              target.pathname !== current.pathname ||
              target.search !== current.search ||
              (target.hash && target.hash !== "#")
            ) {
              continue;
            }
          } catch {
            continue;
          }
        }
      }
      const label = (
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (el as HTMLElement).innerText ||
        ""
      ).trim().replace(/\s+/g, " ").slice(0, 160);
      if (unsafeAction.test(label)) continue;

      const disclosureHint = `${
        el.getAttribute("class") ?? ""
      } ${label}`.toLowerCase();
      const controlledIds = (el.getAttribute("aria-controls") ?? "")
        .split(/\s+/)
        .filter(Boolean);
      const controlsDisclosure = controlledIds.some((id) => {
        const controlled = document.getElementById(id);
        return (
          controlled !== null &&
          !controlled.matches("input,select,textarea,output")
        );
      });
      const hasDisclosureSemantics =
        el.tagName === "SUMMARY" ||
        el.getAttribute("aria-expanded") === "false" ||
        controlsDisclosure ||
        !!el.getAttribute("aria-haspopup") ||
        /^(modal|dropdown|collapse)$/i.test(el.getAttribute("data-toggle") ?? "") ||
        /\b(open|modal|dialog|popup|overlay|dropdown|toggle|accordion|collapse|menu|railcard|country|currency|language|filter)\b/.test(
          disclosureHint,
        );
      const qualifies =
        hasDisclosureSemantics ||
        (el.tagName !== "A" && /\b(open|show|add|choose|select)\b/i.test(label));
      if (!qualifies) continue;

      const selector = selectorFor(el);
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      result.push({ selector, label: label || selector });
    }
    return result;
  });
}

async function exploreInteractiveStates(
  page: Page,
  triggers: SafeInteractionTrigger[],
  replayStylesheets: Map<string, Promise<string | null>>,
  selectedRules?: string[],
): Promise<{
  issues: ScanIssue[];
  states: InteractionStateEvidence[];
  stats: RuleCheckStat[];
}> {
  const selectedRuleSet = getSelectedRuleIds(selectedRules);
  const issues: ScanIssue[] = [];
  const states: InteractionStateEvidence[] = [];
  const stats: RuleCheckStat[] = [];
  const seenIssues = new Set<string>();

  for (let index = 0; index < triggers.length; index++) {
    const trigger = triggers[index]!;
    const visibilityToken = `ampera-state-${index + 1}`;
    try {
      const before = await page.evaluate(({ selector, visibilityToken }) => {
        const visible = (el: Element): boolean => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
            style.visibility !== "hidden" && Number.parseFloat(style.opacity) > 0;
        };
        document.querySelectorAll("*").forEach((el) => {
          if (visible(el)) {
            (el as HTMLElement).dataset.amperaVisibleBefore = visibilityToken;
          }
        });
        const dialogs = Array.from(
          document.querySelectorAll("[role='dialog'],dialog,[role='menu'],[role='listbox']"),
        ).filter(visible).length;
        return {
          url: location.href,
          dialogs,
          expanded: document.querySelector(selector)?.getAttribute("aria-expanded"),
        };
      }, { selector: trigger.selector, visibilityToken });

      await page.click(trigger.selector);
      await new Promise((resolve) => setTimeout(resolve, 450));

      const revealed = await page.evaluate(
        ({ selector, beforeDialogs, beforeExpanded, beforeUrl, visibilityToken }) => {
          if (location.href !== beforeUrl) return false;
          const visible = (el: Element): boolean => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
              style.visibility !== "hidden" && Number.parseFloat(style.opacity) > 0;
          };
          const current = document.querySelector(selector);
          const controls = (current?.getAttribute("aria-controls") ?? "")
            .split(/\s+/)
            .filter(Boolean);
          const controlledVisible = controls.some((id) => {
            const target = document.getElementById(id);
            return target ? visible(target) : false;
          });
          const dialogs = Array.from(
            document.querySelectorAll("[role='dialog'],dialog,[role='menu'],[role='listbox']"),
          ).filter(visible).length;
          const newlyVisible = Array.from(document.querySelectorAll("*")).filter(
            (el) =>
              visible(el) &&
              (el as HTMLElement).dataset.amperaVisibleBefore !== visibilityToken,
          ).length;
          return (
            current?.getAttribute("aria-expanded") === "true" ||
            (current?.tagName === "SUMMARY" && (current.parentElement as HTMLDetailsElement)?.open) ||
            controlledVisible ||
            dialogs > beforeDialogs ||
            newlyVisible > 0 ||
            (beforeExpanded === "false" && current?.getAttribute("aria-expanded") !== "false")
          );
        },
        {
          selector: trigger.selector,
          beforeDialogs: before.dialogs,
          beforeExpanded: before.expanded,
          beforeUrl: before.url,
          visibilityToken,
        },
      );

      if (!revealed) continue;

      const stateKey = `interaction-${index + 1}`;
      const result = await runACTRules(page, selectedRules);
      stats.push(...result.stats);
      let stateIssues = result.issues.filter(
        (issue) =>
          isRuleSelected(issue.ruleId, selectedRuleSet),
      );

      const bboxes = await page.evaluate(({ selectors, visibilityToken }) => {
        const isVisible = (candidate: Element): boolean => {
          let current: Element | null = candidate;
          while (current) {
            const style = getComputedStyle(current);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.visibility === "collapse" ||
              Number.parseFloat(style.opacity) === 0
            ) {
              return false;
            }
            current = current.parentElement;
          }
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        return selectors.map((selector) => {
          if (!selector) return null;
          try {
            const el = document.querySelector(selector);
            if (!el) return null;
            const wasVisibleBefore =
              (el as HTMLElement).dataset.amperaVisibleBefore === visibilityToken;
            let snapshotTarget = el;
            if (!isVisible(snapshotTarget)) {
              let ancestor = snapshotTarget.parentElement;
              while (ancestor && ancestor !== document.body) {
                if (isVisible(ancestor)) {
                  const rect = ancestor.getBoundingClientRect();
                  const viewportArea = Math.max(1, innerWidth * innerHeight);
                  if (rect.width * rect.height > viewportArea * 0.35) return null;
                  snapshotTarget = ancestor;
                  break;
                }
                ancestor = ancestor.parentElement;
              }
              if (!ancestor || ancestor === document.body) return null;
            }
            const rect = snapshotTarget.getBoundingClientRect();
            return {
              x: Math.round(rect.left + scrollX),
              y: Math.round(rect.top + scrollY),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              wasVisibleBefore,
            };
          } catch {
            return null;
          }
        });
      }, {
        selectors: stateIssues.map((issue) => issue.selector),
        visibilityToken,
      });

      stateIssues = stateIssues
        .map((issue, issueIndex): ScanIssue => {
          const wcag = WCAG_MAPPING[issue.ruleId];
          return {
            ...issue,
            wcagCriteria: wcag?.sc?.join(", ") || null,
            wcagLevel: wcag?.level?.join(", ") || null,
            legal: getLegalCompliance(wcag?.level || []),
            bboxX: bboxes[issueIndex]?.x ?? null,
            bboxY: bboxes[issueIndex]?.y ?? null,
            bboxWidth: bboxes[issueIndex]?.width ?? null,
            bboxHeight: bboxes[issueIndex]?.height ?? null,
            interactionStateKey: stateKey,
          };
        })
        .filter((_issue, issueIndex) => bboxes[issueIndex]?.wasVisibleBefore === false)
        .filter((issue) => {
          const key = `${issue.ruleId}|${issue.selector ?? ""}|${issue.description}`;
          if (seenIssues.has(key)) return false;
          seenIssues.add(key);
          return true;
        });

      if (stateIssues.length > 0) {
        const [screenshotBuffer, pageHtml] = await Promise.all([
          page.screenshot({ type: "jpeg", quality: 40, fullPage: true }),
          captureReplayHtml(page, replayStylesheets),
        ]);
        states.push({
          key: stateKey,
          triggerSelector: trigger.selector,
          triggerLabel: trigger.label,
          screenshot: Buffer.from(screenshotBuffer).toString("base64"),
          pageHtml,
        });
        issues.push(...stateIssues);
      }
    } catch (err) {
      logger.debug(
        { selector: trigger.selector, err },
        "Interactive state could not be scanned",
      );
    } finally {
      await page.keyboard.press("Escape").catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 150));
      await page.evaluate((selector) => {
        const trigger = document.querySelector(selector) as HTMLElement | null;
        if (trigger?.getAttribute("aria-expanded") === "true") trigger.click();
        const details = trigger?.closest("details") as HTMLDetailsElement | null;
        if (details?.open) details.open = false;
      }, trigger.selector).catch(() => {});
      await page.evaluate((visibilityToken) => {
        document
          .querySelectorAll(`[data-ampera-visible-before="${visibilityToken}"]`)
          .forEach((el) => delete (el as HTMLElement).dataset.amperaVisibleBefore);
      }, visibilityToken).catch(() => {});
    }
  }

  return { issues, states, stats };
}

async function runACTRules(
  page: Page,
  selectedRules?: string[],
): Promise<{
  issues: ScanIssue[];
  stats: RuleCheckStat[];
  ruleStatuses: RuleExecutionStatus[];
}> {
  const selected = getSelectedRuleIds(selectedRules);
  const emitManualOnlyRules = hasManualRuleSelected(selected);
  // The registry supersedes this legacy pair, while retaining its behavior:
  // ["ACT-R24", "ACT-R118"].includes and selectedRuleSet.has("ACT-R24") /
  // selectedRuleSet.has("ACT-R118") are now represented by metadata.
  const languageDetectorBuildMarker = "language-detector-franc-min-v1";
  // Production embeds the browser rule bundle in index.mjs so Azure and zip
  // deployments cannot lose it as a sibling asset. Keep the standalone-file
  // path as a development/backwards-compatible fallback.
  if (typeof __AMPERA_BROWSER_BUNDLE__ !== "undefined") {
    await page.addScriptTag({ content: __AMPERA_BROWSER_BUNDLE__ });
  } else {
    const bundlePath = path.join(__dirname, "browser-bundle.js");
    await page.addScriptTag({ path: bundlePath });
  }

  const bundlePreflight = await page.evaluate((expectedMarker) => {
    const engine = (window as any).__ampera;
    if (
      !engine ||
      typeof engine.runAllRules !== "function" ||
      !Array.isArray(engine.buildMarkers) ||
      !engine.buildMarkers.includes(expectedMarker)
    ) {
      return "The deployed browser-rule bundle is stale or incomplete";
    }
    if (typeof engine.verifyLanguageDetectorBundle !== "function") {
      return "The deployed browser-rule bundle has no language-detector self-check";
    }
    try {
      return engine.verifyLanguageDetectorBundle() === true
        ? null
        : "The bundled language detector returned an unexpected result";
    } catch (error) {
      return `The bundled language detector failed: ${String(error)}`;
    }
  }, languageDetectorBuildMarker);
  if (bundlePreflight) {
    throw new Error(
      `Invalid scanner browser bundle: ${bundlePreflight}. Rebuild and redeploy the current API artifact.`,
    );
  }

  const bundleResult: {
    issues: Array<{
      ruleId: string;
      type: string;
      displayTitle?: string;
      impact: string;
      description: string;
      element: string | null;
      elementContext?: string | null;
      selector: string | null;
    }>;
    stats: Array<{
      ruleId: string;
      totalChecked: number;
      scope: "element" | "page";
    }>;
    ruleStatuses?: RuleExecutionStatus[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = await page.evaluate(
    (options) => (window as any).__ampera.runAllRules(options),
    { emitManualOnlyRules, rules: selectedRules },
  );

  // ─── Map results → ScanIssue with WCAG metadata ──────────────────────────
  const issues: ScanIssue[] = [];
  for (const r of bundleResult.issues) {
    const wcag = WCAG_MAPPING[r.ruleId];
    const desc = RULE_DESCRIPTIONS[r.ruleId];
    const meta = RULE_DESCRIPTIONS[r.ruleId];
    issues.push({
      ruleId: r.ruleId,
      // These checks can only identify media requiring human review; they
      // cannot determine whether captions, descriptions, or alternatives
      // are complete and equivalent.
      type:
        r.type === "Issue" ||
        r.type === "Potential Issue" ||
        r.type === "Best Practice" ||
        r.type === "WAI-ARIA"
          ? r.type
          : (meta?.type ?? r.type),
      impact: r.impact as ScanIssue["impact"],
      description: desc
        ? `${r.displayTitle ?? (r.type === "Issue" ? desc.issueDescription : desc.potentialDescription) ?? desc.description}: ${r.description}`
        : r.description,
      element: r.element,
      wcagCriteria: wcag ? wcag.sc.join(", ") : null,
      wcagLevel: wcag ? wcag.level.join(", ") : null,
      selector: r.selector,
      remediation: desc?.remediation || null,
      legal: getLegalCompliance(wcag?.level || []),
    });
  }

  return {
    issues,
    stats: bundleResult.stats,
    ruleStatuses: bundleResult.ruleStatuses ?? [],
  };
}

/**
 * Lightweight raw-HTML fetch through a pooled stealth browser — used by
 * incremental scans when a plain HTTP fetch is WAF-blocked (e.g. 403).
 * Blocks all non-document resources so it costs only the navigation itself.
 * Returns the raw (pre-JS-mutation) response body, or null on failure.
 */
export function fetchRawHtmlViaBrowser(url: string): Promise<string | null> {
  const pool = ensurePool();
  let slot = pool[0]!;
  for (const s of pool) {
    if (s.pending < slot.pending) slot = s;
  }
  slot.pending++;
  const result = slot.chain.then(async (): Promise<string | null> => {
    let page: Page | null = null;
    try {
      const browser = await getBrowser(slot);
      page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        // Cloudflare's managed challenge needs its script and same-page fetch
        // requests to run. Keep these lightweight rendering resources while
        // still blocking the heavy assets that are irrelevant to raw HTML.
        if (["document", "script", "stylesheet", "xhr", "fetch"].includes(req.resourceType())) {
          req.continue().catch(() => {});
        } else {
          req.abort().catch(() => {});
        }
      });
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      // Do not treat Cloudflare's first interstitial response as final. This
      // browser uses the durable scanner profile and may finish the challenge
      // or reuse a clearance cookie shortly after the first document arrives.
      const isChallenge = async (): Promise<boolean> =>
        page!.evaluate(() => {
          const title = document.title.toLowerCase();
          const text = document.body?.innerText?.toLowerCase() ?? "";
          return (
            title.includes("just a moment") ||
            title.includes("checking your browser") ||
            text.includes("verifying your connection") ||
            text.includes("checking your browser before accessing") ||
            text.includes("enable javascript and cookies") ||
            !!document.querySelector(
              "#challenge-form, #cf-challenge-running, .cf-browser-verification, [id^='challenge-']",
            )
          );
        }).catch(() => true);

      const challengeDeadline = Date.now() + 35_000;
      while (await isChallenge()) {
        if (Date.now() >= challengeDeadline) return null;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }

      const body = await page.content();
      return body.trim() ? body : null;
    } catch {
      return null;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  });
  const settled = result.then(
    () => {},
    () => {},
  );
  settled.then(() => {
    slot.pending = Math.max(0, slot.pending - 1);
  });
  slot.chain = Promise.race([
    settled,
    new Promise<void>((r) => setTimeout(r, 60_000)),
  ]);
  return result;
}

export async function closeBrowser(): Promise<void> {
  await Promise.all(
    _pool.map(async (slot) => {
      if (slot.browser) {
        await slot.browser.close().catch(() => {});
        slot.browser = null;
      }
    }),
  );
}

/**
 * Force-drops all pooled browser instances so the next scanPage() call
 * launches fresh Chrome processes.  Call this after a TargetCloseError or
 * "Execution context was destroyed" error so the corrupted browser state
 * doesn't poison subsequent retry attempts.
 */
export function resetBrowserInstance(): void {
  for (const slot of _pool) {
    if (slot.browser) {
      slot.browser.close().catch(() => {});
      slot.browser = null;
    }
  }
}
