import { describe, expect, it } from "vitest";
import { getCrawlerProxyLaunchArg } from "./crawler";

describe("crawler proxy launch configuration", () => {
  it("uses the PAC flag for a PAC URL", () => {
    expect(getCrawlerProxyLaunchArg("https://proxy.example.com/proxy.pac"))
      .toBe("--proxy-pac-url=https://proxy.example.com/proxy.pac");
  });

  it.each([
    "http://proxy.example.com:8080",
    "https://proxy.example.com:8443",
    "socks4://proxy.example.com:1080",
    "socks5://proxy.example.com:1080",
  ])("uses the direct proxy flag for %s", (proxyUrl) => {
    expect(getCrawlerProxyLaunchArg(proxyUrl)).toBe(`--proxy-server=${proxyUrl}`);
  });
});