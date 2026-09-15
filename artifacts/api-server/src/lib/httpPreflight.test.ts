import { describe, expect, it } from "vitest";
import {
  classifyStaticHtml,
  MAX_STATIC_HTML_BYTES,
  redactProvenanceUrl,
  runStaticHtmlPreflight,
  shouldRunStaticPreflight,
} from "./httpPreflight";

describe("static HTML preflight", () => {
  it("classifies challenge, non-HTML, empty, and error responses conservatively", () => {
    expect(
      classifyStaticHtml(403, "text/html", "<title>Just a moment...</title>"),
    ).toBe("waf_challenge");
    expect(classifyStaticHtml(200, "application/pdf", "%PDF")).toBe("non_html");
    expect(classifyStaticHtml(200, "text/html", "   ")).toBe("empty");
    expect(
      classifyStaticHtml(200, "text/html", "<title>404 Not Found</title>"),
    ).toBe("error_html");
    expect(classifyStaticHtml(200, "text/html", "<!doctype html><h1>Welcome</h1>")).toBe("ok");
    expect(classifyStaticHtml(200, "text/html", "x".repeat(MAX_STATIC_HTML_BYTES + 1))).toBe("oversized");
  });

  it("redacts URL credentials and sensitive query values", () => {
    const operationalTarget =
      "https://example.test/download?X-Amz-Signature=keep-this-signature&token=secret";
    const safe = redactProvenanceUrl(
      "https://alice:password@example.test/path?utm=x&api_key=secret&token=abc#fragment",
    );
    expect(safe).toContain("utm=x");
    expect(safe).toContain("api_key=%5BREDACTED%5D");
    expect(safe).toContain("token=%5BREDACTED%5D");
    expect(safe).not.toContain("password");
    expect(safe).not.toContain("fragment");
    // Redaction is a persistence/API transform; it must not mutate the target
    // passed to navigation (signed URLs are operational credentials).
    redactProvenanceUrl(operationalTarget);
    expect(operationalTarget).toContain("X-Amz-Signature=keep-this-signature");
  });

  it("does not produce a carry-forward hash for an error/challenge page", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("<title>Just a moment...</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    try {
      const result = await runStaticHtmlPreflight("https://example.test/?token=secret");
      expect(result).toBeDefined();
      if (!result) throw new Error("expected direct preflight result");
      expect(result.classification).toBe("waf_challenge");
      expect(result.rawHtmlHash).toBeUndefined();
      expect(result.requestedUrl).toContain("token=%5BREDACTED%5D");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("bounds HTML response bodies and classifies oversized documents", async () => {
    const originalFetch = globalThis.fetch;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<!doctype html>"));
        controller.enqueue(new Uint8Array(MAX_STATIC_HTML_BYTES));
        controller.enqueue(new TextEncoder().encode("tail"));
      },
      cancel() {
        cancelled = true;
      },
    });
    globalThis.fetch = (async () =>
      new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-length": String(MAX_STATIC_HTML_BYTES + 1),
        },
      })) as typeof fetch;
    try {
      const result = await runStaticHtmlPreflight("https://example.test/large");
      expect(result?.classification).toBe("oversized");
      expect(result?.rawHtmlHash).toBeUndefined();
      expect(cancelled).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("suppresses direct static fetch when a proxy/PAC is configured", async () => {
    expect(shouldRunStaticPreflight("http://proxy.internal/pac")).toBe(false);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("static fetch must not bypass configured proxy");
    }) as typeof fetch;
    try {
      await expect(
        runStaticHtmlPreflight("https://example.test/", {
          proxyStrategy: "configured_proxy",
          proxyPacUrl: "http://proxy.internal:8080",
        }),
      ).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});