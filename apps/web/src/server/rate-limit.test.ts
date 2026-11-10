import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getPool: () => { throw new Error("not used"); } }));
vi.mock("./crypto", () => ({ hmac: (value: string) => value }));
const { requestAddress } = await import("./rate-limit");

const req = (headers: Record<string, string>) => new Request("https://x/", { headers });

describe("requestAddress", () => {
  it("ignores client-supplied X-Forwarded-For entries", () => {
    expect(requestAddress(req({ "x-forwarded-for": "1.1.1.1, 203.0.113.9, 130.176.0.1" }))).toBe("203.0.113.9");
  });
  it("uses the CloudFront viewer header when present, IPv4 and IPv6", () => {
    expect(requestAddress(req({ "cloudfront-viewer-address": "203.0.113.9:4431", "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("203.0.113.9");
    expect(requestAddress(req({ "cloudfront-viewer-address": "2001:db8::1:4431" }))).toBe("2001:db8::1");
  });
  it("falls back safely", () => {
    expect(requestAddress(req({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(requestAddress(req({}))).toBe("unknown");
  });
});
