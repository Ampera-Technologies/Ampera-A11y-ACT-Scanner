import { describe, expect, it } from "vitest";
import { matchesCrawlerPathFilters } from "./crawler";

describe("crawler path filters", () => {
  it("allows a path matching any configured filter", () => {
    const filters = ["/us/en", "/en-us", "/support"];

    expect(matchesCrawlerPathFilters("/us/en/products", filters)).toBe(true);
    expect(matchesCrawlerPathFilters("/help/support/article", filters)).toBe(true);
    expect(matchesCrawlerPathFilters("/fr/fr/products", filters)).toBe(false);
  });

  it("keeps legacy single-filter crawler sessions working", () => {
    expect(matchesCrawlerPathFilters("/en-us/products", undefined, "/en-us")).toBe(true);
    expect(matchesCrawlerPathFilters("/de-de/products", undefined, "/en-us")).toBe(false);
  });

  it("allows every path when no filters are configured", () => {
    expect(matchesCrawlerPathFilters("/any/path")).toBe(true);
  });
});