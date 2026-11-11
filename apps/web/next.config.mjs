import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** @type {import('next').NextConfig} */
export default {
  output: "standalone",
  outputFileTracingRoot: root,
  poweredByHeader: false,
  transpilePackages: ["@theckards/domain"],
  async headers() {
    return [
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/(.*)", headers: [
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      // Nothing here uses these device features, so no page, or anything injected into one, can ask for them.
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
      // A page opened from here, or one that opens this site, gets no handle on its window.
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      // The Content-Security-Policy is not set here: it carries a nonce per request (src/middleware.ts), and a second,
      // static policy would be enforced as well and block every script.
      ] },
    ];
  },
};
