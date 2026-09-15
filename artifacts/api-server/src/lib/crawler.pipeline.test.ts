import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  canRunDiscoveryWorker,
  classifyDiscoveryFailure,
  getDiscoveryBackpressureDecision,
  getDiscoveryBackpressureLimits,
  getDiscoveryProfileDir,
  getDiscoveryRetryDelayMs,
  shouldAttemptCrawlerCarryForward,
} from "./crawler";

describe("crawler pipeline state guards", () => {
  it("uses the runScanPhase incremental gate only for a matching completed hash", () => {
    expect(shouldAttemptCrawlerCarryForward(true, "same", "same")).toBe(true);
    expect(shouldAttemptCrawlerCarryForward(true, "fresh", "old")).toBe(false);
    expect(shouldAttemptCrawlerCarryForward(true, "", "same")).toBe(false);
    expect(shouldAttemptCrawlerCarryForward(false, "same", "same")).toBe(false);
  });

  it("keeps normal discovery workers in Phase 1 only", () => {
    expect(canRunDiscoveryWorker("discovering", false)).toBe(true);
    expect(canRunDiscoveryWorker("scanning", false)).toBe(false);
    expect(canRunDiscoveryWorker("paused", false)).toBe(false);
    expect(canRunDiscoveryWorker("completed", false)).toBe(false);
  });

  it("keeps Crawl Boost discovery workers alive while Phase 2 is scanning", () => {
    expect(canRunDiscoveryWorker("discovering", true)).toBe(true);
    expect(canRunDiscoveryWorker("scanning", true)).toBe(true);
    expect(canRunDiscoveryWorker("paused", true)).toBe(false);
    expect(canRunDiscoveryWorker("completed", true)).toBe(false);
  });
});

describe("discovery profile storage", () => {
  it("uses a distinct persistent sibling of the scanner profile by default", () => {
    expect(
      getDiscoveryProfileDir({
        HOME: "/root",
        CHROME_PROFILE_DIR: "/home/a11y-chrome-profile",
      }),
    ).toBe("/home/a11y-chrome-profile-discovery");
  });

  it("honors an explicit discovery-profile override", () => {
    expect(
      getDiscoveryProfileDir({
        HOME: "/root",
        CHROME_PROFILE_DIR: "/home/a11y-chrome-profile",
        CRAWLER_PROFILE_DIR: "/mnt/crawler-profile",
      }),
    ).toBe("/mnt/crawler-profile");
  });
});

describe("crawler discovery reliability controls", () => {
  it("classifies only the transient HTTP statuses for retry", () => {
    expect(classifyDiscoveryFailure(408).retryable).toBe(true);
    expect(classifyDiscoveryFailure(425).retryable).toBe(true);
    expect(classifyDiscoveryFailure(429).retryable).toBe(true);
    expect(classifyDiscoveryFailure(503).class).toBe("http_5xx");
    expect(classifyDiscoveryFailure(404).retryable).toBe(false);
    expect(classifyDiscoveryFailure(403).retryable).toBe(false);
  });

  it("classifies DNS, timeout, and proxy failures as transient", () => {
    expect(classifyDiscoveryFailure(undefined, new Error("ERR_NAME_NOT_RESOLVED")).class).toBe("dns");
    expect(classifyDiscoveryFailure(undefined, new Error("Navigation timeout")).class).toBe("timeout");
    expect(classifyDiscoveryFailure(undefined, new Error("ERR_PROXY_CONNECTION_FAILED")).class).toBe("proxy");
  });

  it("keeps exponential retry delay bounded and jittered", () => {
    expect(getDiscoveryRetryDelayMs(1, {}, () => 0)).toBe(750);
    expect(getDiscoveryRetryDelayMs(3, {}, () => 1)).toBe(5000);
    expect(getDiscoveryRetryDelayMs(20, { discoveryRetryMaxDelayMs: 2000 }, () => 1)).toBe(2000);
  });

  it("normalizes high and low queue watermarks into a bounded hysteresis pair", () => {
    expect(getDiscoveryBackpressureLimits({
      maxPages: 50,
      discoveryQueueHighWatermark: 100,
      discoveryQueueLowWatermark: 80,
    })).toEqual({ highWatermark: 50, lowWatermark: 49 });
    expect(getDiscoveryBackpressureLimits({ maxPages: 200 })).toEqual({
      highWatermark: 100,
      lowWatermark: 50,
    });
  });

  it("lets concurrent pending claims continue while preserving link inserts across drain", async () => {
    const limits = { highWatermark: 4, lowWatermark: 2 };
    const decisions = await Promise.all([
      Promise.resolve(getDiscoveryBackpressureDecision(4, false, limits)),
      Promise.resolve(getDiscoveryBackpressureDecision(4, false, limits)),
    ]);
    expect(decisions.every((decision) => decision.allowPendingClaims)).toBe(true);
    expect(decisions.every((decision) => decision.allowLinkEnqueue)).toBe(true);

    const drained = getDiscoveryBackpressureDecision(2, true, limits);
    expect(drained.throttled).toBe(false);
    expect(drained.allowPendingClaims).toBe(true);
    expect(drained.allowLinkEnqueue).toBe(true);
  });
});

describe("crawler shutdown registration guards", () => {
  it("registers direct /start-scan fire-and-forget and resume entry paths", () => {
    const crawlerSource = readFileSync(new URL("./crawler.ts", import.meta.url), "utf8");
    const routeSource = readFileSync(new URL("../routes/crawler.ts", import.meta.url), "utf8");

    // The route intentionally does not await Phase 2, so the exported boundary
    // must register it before returning the promise to the fire-and-forget call.
    expect(routeSource).toMatch(/void startScanPhase\(sessionId\)\.catch/);
    expect(crawlerSource).toMatch(
      /export function startScanPhase\(sessionId: number\): Promise<void>[\s\S]*?registerCrawlerWork\(\(\) => runStartScanPhase\(sessionId\)\)/,
    );
    expect(crawlerSource).toMatch(
      /export function resumeCrawlerJob\(sessionId: number\): Promise<void>[\s\S]*?registerCrawlerWork\(\(\) => runResumeCrawlerJob\(sessionId\)\)/,
    );
    expect(crawlerSource).toContain("tracked.finally(() =>");
  });
});