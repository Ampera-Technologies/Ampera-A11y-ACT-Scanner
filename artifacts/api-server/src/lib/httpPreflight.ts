import { createHash } from "crypto";

export type StaticHtmlClassification =
  | "ok"
  | "http_error"
  | "non_html"
  | "empty"
  | "oversized"
  | "waf_challenge"
  | "error_html";

export interface StaticHtmlSignals {
  bytes: number;
  title?: string;
  h1Count: number;
  linkCount: number;
  formCount: number;
  scriptCount: number;
  bodyTextLength: number;
  hasDoctype: boolean;
}

export interface StaticHtmlPreflight {
  requestedUrl: string;
  finalUrl?: string;
  status?: number;
  contentType?: string;
  capturedAt: Date;
  classification: StaticHtmlClassification;
  signals?: StaticHtmlSignals;
  rawHtmlHash?: string;
  acquisitionMethod: "static_http";
  proxyStrategy: "direct" | "configured_pac";
}

/** Static fetch uses the platform's direct fetch only; never bypass a proxy. */
export function shouldRunStaticPreflight(proxyPacUrl?: string | null): boolean {
  return !(proxyPacUrl ?? "").trim();
}

const SECRET_QUERY_KEY =
  /pass(word)?|token|secret|api[_-]?key|auth|credential|session|cookie|sig(nature)?|access[_-]?key|private|(?:oauth[_-]?)?code|jwt/i;

/** Remove credentials and secret query values before provenance is persisted. */
export function redactProvenanceUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_KEY.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

export function hashPreflightHtml(html: string): string {
  const normalized = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script></script>")
    .replace(/\snonce="[^"]*"/gi, "")
    .replace(/<meta[^>]*csrf[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

export function hashRenderedDom(html: string): string {
  return createHash("sha256").update(html).digest("hex").slice(0, 32);
}

function structuralSignals(html: string): StaticHtmlSignals {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    bytes: Buffer.byteLength(html),
    title: html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim().slice(0, 500),
    h1Count: (html.match(/<h1\b/gi) ?? []).length,
    linkCount: (html.match(/<a\b/gi) ?? []).length,
    formCount: (html.match(/<form\b/gi) ?? []).length,
    scriptCount: (html.match(/<script\b/gi) ?? []).length,
    bodyTextLength: text.length,
    hasDoctype: /^\s*<!doctype\s+html/i.test(html),
  };
}

const CHALLENGE_MARKERS =
  /just a moment|verifying your connection|checking your browser|enable javascript and cookies|cf[-_ ]?challenge|access denied(?: by cloudflare)?|security check|ddos protection|attention required|captcha/i;
const ERROR_MARKERS =
  /<title[^>]*>\s*(?:4\d\d|5\d\d|error|not found|page unavailable|access denied)\b|(?:page|server)\s+(?:not found|unavailable)|internal server error/i;

/** Keep the static preflight deliberately smaller than the browser's page budget. */
export const MAX_STATIC_HTML_BYTES = 2 * 1024 * 1024;

export function classifyStaticHtml(
  status: number | undefined,
  contentType: string | undefined,
  html: string | undefined,
  oversized = false,
): StaticHtmlClassification {
  if (oversized || (html != null && Buffer.byteLength(html) > MAX_STATIC_HTML_BYTES)) {
    return "oversized";
  }
  const body = html ?? "";
  const sample = body.slice(0, 20_000);
  if (status != null && status >= 400 && CHALLENGE_MARKERS.test(sample)) return "waf_challenge";
  if (CHALLENGE_MARKERS.test(sample)) return "waf_challenge";
  if (contentType && !/html|xhtml/i.test(contentType)) return "non_html";
  if (!body.trim()) return "empty";
  if (status != null && status >= 400) return "http_error";
  if (ERROR_MARKERS.test(sample)) return "error_html";
  return "ok";
}

/**
 * Read an HTML response without ever accumulating more than the preflight
 * budget.  A Content-Length check is only an optimisation: chunked responses
 * must still be enforced while reading the stream.
 */
async function readBoundedHtml(
  response: Response,
  maxBytes: number,
): Promise<{ html: string; oversized: boolean }> {
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    if (response.body) await response.body.cancel().catch(() => {});
    return { html: "", oversized: true };
  }

  if (!response.body) return { html: "", oversized: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkBytes = value.byteLength;
      bytes += chunkBytes;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        return { html: "", oversized: true };
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return { html: chunks.join(""), oversized: false };
  } finally {
    reader.releaseLock();
  }
}

/**
 * Cheap, bounded preflight. It intentionally never supplies accessibility
 * findings: Chromium remains the authority for rendered visibility and rules.
 */
export async function runStaticHtmlPreflight(
  requestedUrl: string,
  options: {
    proxyStrategy?: "direct" | "configured_pac" | "configured_proxy";
    proxyPacUrl?: string;
    timeoutMs?: number;
  } = {},
): Promise<StaticHtmlPreflight | undefined> {
  // There is no safe Node fetch/PAC adapter in this pipeline. Callers must
  // let Chromium perform the acquisition instead of accidentally bypassing
  // the configured proxy.
  if (
    options.proxyPacUrl?.trim() ||
    (options.proxyStrategy && options.proxyStrategy !== "direct")
  ) {
    return undefined;
  }
  const capturedAt = new Date();
  const base: StaticHtmlPreflight = {
    requestedUrl: redactProvenanceUrl(requestedUrl),
    capturedAt,
    classification: "empty",
    acquisitionMethod: "static_http",
    proxyStrategy: options.proxyStrategy ?? "direct",
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
    try {
      const response = await fetch(requestedUrl, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      const contentType = response.headers.get("content-type") ?? undefined;
      const { html, oversized } = /html|xhtml/i.test(contentType ?? "")
        ? await readBoundedHtml(response, MAX_STATIC_HTML_BYTES)
        : { html: "", oversized: false };
      const classification = classifyStaticHtml(response.status, contentType, html, oversized);
      return {
        ...base,
        finalUrl: redactProvenanceUrl(response.url || requestedUrl),
        status: response.status,
        contentType: contentType?.split(";")[0]?.trim().toLowerCase(),
        classification,
        signals: html ? structuralSignals(html) : undefined,
        rawHtmlHash: html && classification === "ok"
          ? hashPreflightHtml(html)
          : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ...base, classification: "empty" };
  }
}