import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, middleware } from "./middleware";

/**
 * What the Content-Security-Policy (server/http/csp.ts) depends on outside the policy itself. Each of these would
 * break pages in the browser without failing any server-side test.
 */
const webRoot = process.cwd();
const appRoot = path.join(webRoot, "src/app");

async function files(directory: string, pattern: RegExp): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(full, pattern);
    return Promise.resolve(pattern.test(entry.name) && !entry.name.includes(".test.") ? [full] : []);
  }));
  return nested.flat();
}

const policyOf = (response: Response) => response.headers.get("content-security-policy") ?? "";
const nonceOf = (policy: string) => /'nonce-([^']+)'/.exec(policy)?.[1];

describe("the middleware", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("gives every response its own nonce", () => {
    const first = nonceOf(policyOf(middleware(new NextRequest("https://theckards.linkealls.com/verify"))));
    const second = nonceOf(policyOf(middleware(new NextRequest("https://theckards.linkealls.com/verify"))));
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  // Next.js reads the nonce from the request's policy header while rendering. A response policy alone would
  // block the page's own scripts.
  it("hands the same policy to the renderer, replacing any policy header the client sent", () => {
    const request = new NextRequest("https://theckards.linkealls.com/", { headers: { "content-security-policy": "script-src 'nonce-attacker'" } });
    const response = middleware(request);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(policyOf(response));
    expect(policyOf(response)).not.toContain("attacker");
  });

  it("allows uploads to the quarantine bucket the service is configured with", () => {
    vi.stubEnv("EVIDENCE_QUARANTINE_BUCKET", "theckards-prod-evidence-quarantine-116708768297");
    vi.stubEnv("AWS_REGION", "us-east-1");
    const policy = policyOf(middleware(new NextRequest("https://theckards.linkealls.com/agreements/x")));
    expect(policy).toContain("connect-src 'self' https://theckards-prod-evidence-quarantine-116708768297.s3.us-east-1.amazonaws.com;");
  });

  it("runs on every page and stays off routes that return data", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const page of ["/", "/verify", "/verify/how", "/legal/terms", "/dashboard", "/agreements/new", "/agreements/0c1d", "/g/token", "/s/token", "/claim", "/account", "/admin", "/admin/mfa", "/does-not-exist"]) {
      expect(matcher.test(page), page).toBe(true);
    }
    for (const data of ["/api/agreements", "/api/public/verify/abc", "/_next/static/chunks/main.js", "/healthz", "/readyz", "/.well-known/theckards-keys.json", "/icon.svg"]) {
      expect(matcher.test(data), data).toBe(false);
    }
  });
});

describe("pages the policy can run", () => {
  it("are rendered per request, so their scripts carry the nonce", async () => {
    const layout = await readFile(path.join(appRoot, "layout.tsx"), "utf8");
    expect(layout).toMatch(/^\s*await connection\(\);/m);
  });

  it("carry no style attributes, which the policy makes the browser ignore", async () => {
    const offenders: string[] = [];
    for (const file of await files(appRoot, /\.tsx$/)) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/\bstyle=\{/g)) offenders.push(`${path.relative(appRoot, file)} at offset ${match.index}`);
    }
    expect(offenders).toEqual([]);
  });

  it("inject HTML in one place only, the QR code", async () => {
    const injecting: string[] = [];
    for (const file of await files(appRoot, /\.tsx$/)) {
      if ((await readFile(file, "utf8")).includes("dangerouslySetInnerHTML")) injecting.push(path.relative(appRoot, file));
    }
    expect(injecting).toEqual([path.join("agreements", "[id]", "AgreementActions.tsx")]);
  });

  // Inserted with innerHTML, so a style attribute or script in it would be blocked like any other.
  it("get a QR code made of SVG shapes and presentation attributes only", async () => {
    const svg = await QRCode.toString("https://theckards.linkealls.com/s/token", { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    expect(new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((match) => match[1]))).toEqual(new Set(["svg", "path"]));
    expect(svg).not.toMatch(/\sstyle=|\son[a-z]+=|<script/i);
  });
});

describe("code the browser runs", () => {
  const domainRoot = path.resolve(webRoot, "../../packages/domain/src");

  async function existingFile(base: string): Promise<string | undefined> {
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
      if (/\.tsx?$/.test(candidate) && await stat(candidate).then((s) => s.isFile(), () => false)) return candidate;
    }
    return undefined;
  }

  /** Value imports only: `import type` and `{ type X }` are erased and never reach the browser. */
  function valueImports(source: string): { from: string; names: string[] }[] {
    return [...source.matchAll(/^import (?!type )([^;]*?) from "([^"]+)";/gm)].map((match) => ({
      from: match[2]!,
      names: (/\{([^}]*)\}/.exec(match[1]!)?.[1] ?? "").split(",").map((name) => name.trim())
        .filter((name) => name && !name.startsWith("type ")).map((name) => name.split(" as ")[0]!.trim()),
    }));
  }

  // zod tests whether eval is allowed when it builds a schema. It catches the refusal, but the browser still reports
  // a violation of the policy, so the browser bundle must not contain zod at all, directly or through a module.
  it("never imports zod, directly or through the domain package", async () => {
    const definedIn = new Map<string, string>();
    for (const file of await readdir(domainRoot)) {
      if (!file.endsWith(".ts") || file.includes(".test.")) continue;
      for (const match of (await readFile(path.join(domainRoot, file), "utf8")).matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)) {
        definedIn.set(match[1]!, path.join(domainRoot, file));
      }
    }
    const offenders: string[] = [];
    const seen = new Set<string>();
    async function visit(file: string, via: string): Promise<void> {
      if (seen.has(file)) return;
      seen.add(file);
      for (const { from, names } of valueImports(await readFile(file, "utf8"))) {
        if (from === "zod" || from.startsWith("zod/")) offenders.push(`${path.relative(webRoot, file)} (reached from ${via}) imports zod`);
        else if (from === "@theckards/domain") {
          for (const name of names) {
            const home = definedIn.get(name);
            if (home) await visit(home, via);
            else offenders.push(`${via}: ${name} is not defined in the domain package`);
          }
        } else if (from.startsWith(".")) {
          const target = await existingFile(path.resolve(path.dirname(file), from.replace(/\.js$/, "")));
          if (target) await visit(target, via);
        }
      }
    }
    for (const file of await files(path.join(webRoot, "src"), /\.tsx?$/)) {
      if (/^["']use client["'];/.test(await readFile(file, "utf8"))) await visit(file, path.relative(webRoot, file));
    }
    expect([...seen].some((file) => file.endsWith("seal-mark.ts")), "the walk reaches the domain package").toBe(true);
    expect(offenders).toEqual([]);
  });
});

describe("headers set by next.config.mjs", () => {
  type HeaderRule = { source: string; headers: { key: string; value: string }[] };

  it("add Permissions-Policy and COOP everywhere, and no second, static CSP", async () => {
    const { default: nextConfig } = await import(pathToFileURL(path.join(webRoot, "next.config.mjs")).href) as { default: { headers(): Promise<HeaderRule[]> } };
    const rules = await nextConfig.headers();
    const all = rules.find((rule) => rule.source === "/(.*)")!.headers;
    expect(all.find((header) => header.key === "Permissions-Policy")?.value).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    expect(all.find((header) => header.key === "Cross-Origin-Opener-Policy")?.value).toBe("same-origin");
    // A browser enforces every policy it receives, so a static one without the nonce would block every script.
    expect(rules.flatMap((rule) => rule.headers).filter((header) => /content-security-policy/i.test(header.key))).toEqual([]);
  });
});
