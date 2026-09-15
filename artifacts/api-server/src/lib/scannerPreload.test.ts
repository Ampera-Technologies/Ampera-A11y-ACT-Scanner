import { describe, expect, it } from "vitest";
import {
  createCrawlerCaptureProvenance,
  preparePreloadedHtml,
} from "./scanner";

describe("crawl boost preload", () => {
  it("establishes a safely escaped base URL without replacing an existing base", () => {
    const html = '<html><head><title>x</title></head><body><img src="/hero.png"></body></html>';
    const prepared = preparePreloadedHtml(
      html,
      'https://example.test/path?q="quoted"&token=secret',
    );
    expect(prepared).toContain(
      'href="https://example.test/path?q=&quot;quoted&quot;&amp;token=secret"',
    );
    expect(prepared).toContain('src="/hero.png"');

    const withBase = '<head><base href="https://cdn.example.test/"></head><body></body>';
    expect(preparePreloadedHtml(withBase, "https://example.test/")).toBe(withBase);
    expect(
      preparePreloadedHtml(
        '<head><base href="/assets/"></head><body></body>',
        "https://example.test/docs/page",
      ),
    ).toContain('<base href="https://example.test/assets/">');
  });

  it("uses Phase 1 metadata for crawler-capture provenance", () => {
    const capturedAt = new Date("2025-01-02T03:04:05.000Z");
    const provenance = createCrawlerCaptureProvenance(
      "https://example.test/start",
      {
        finalUrl: "https://example.test/final",
        httpStatus: 206,
        contentType: "text/html",
        responseCapturedAt: capturedAt,
      },
    );
    expect(provenance).toMatchObject({
      finalUrl: "https://example.test/final",
      httpStatus: 206,
      contentType: "text/html",
      responseCapturedAt: capturedAt,
      acquisitionMethod: "crawler_capture",
    });
    expect(provenance.finalUrl).not.toBe("about:blank");

    const recovered = createCrawlerCaptureProvenance(
      "https://example.test/start",
      { ...provenance, finalUrl: "about:blank", httpStatus: 503 },
    );
    expect(recovered.finalUrl).toBe("https://example.test/start");
    expect(recovered.httpStatus).toBe(503);
  });
});