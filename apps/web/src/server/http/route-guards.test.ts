import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_COOKIE, AUTH_TRANSACTION_COOKIE, DEVICE_COOKIE, USER_COOKIE, deviceCookie } from "../auth/cookies";

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(full) : Promise.resolve(entry.name === "route.ts" ? [full] : []);
  }));
  return nested.flat();
}

describe("API route guard contract", () => {
  it("wraps every API route with the shared route boundary", async () => {
    const root = path.resolve(process.cwd(), "src/app/api");
    for (const file of await routeFiles(root)) {
      const source = await readFile(file, "utf8");
      expect(source, file).toContain("withRoute(");
    }
  });

  it("requires admin auth on every /api/admin route", async () => {
    const root = path.resolve(process.cwd(), "src/app/api/admin");
    for (const file of await routeFiles(root)) {
      const source = await readFile(file, "utf8");
      expect(source, file).toMatch(/auth:\s*"admin"/);
    }
  });

  it("uses __Host cookies and separates user/admin sessions", () => {
    expect(USER_COOKIE).toMatch(/^__Host-/);
    expect(ADMIN_COOKIE).toMatch(/^__Host-/);
    expect(AUTH_TRANSACTION_COOKIE).toMatch(/^__Host-/);
    expect(USER_COOKIE).not.toBe(ADMIN_COOKIE);
  });
});

describe("agreement route authorization contract", () => {
  it("requires a user session on every agreement and template route", async () => {
    const agreementRoot = path.resolve(process.cwd(), "src/app/api/agreements");
    for (const file of await routeFiles(agreementRoot)) {
      const source = await readFile(file, "utf8");
      expect(source, file).toMatch(/auth:\s*"user"/);
    }
    const templates = await readFile(path.resolve(process.cwd(), "src/app/api/templates/route.ts"), "utf8");
    expect(templates).toMatch(/auth:\s*"user"/);
  });

  it("requires If-Match on resource mutations", async () => {
    for (const relative of ["[id]/route.ts", "[id]/invite/route.ts", "[id]/cancel/route.ts", "[id]/milestones/route.ts", "[id]/in-person/route.ts"]) {
      const source = await readFile(path.resolve(process.cwd(), "src/app/api/agreements", relative), "utf8");
      expect(source, relative).toContain("readIfMatch(request)");
    }
  });
});

describe("guest route contract", () => {
  it("rate-limits every token-based guest endpoint and scopes downloads to a guest session", async () => {
    const root = path.resolve(process.cwd(), "src/app/api/guest");
    for (const file of await routeFiles(root)) {
      const source = await readFile(file, "utf8");
      expect(source, file).toContain("rateLimit:");
      if (file.includes("[token]")) expect(source, file).toMatch(/auth:\s*"public"/);
      else expect(source, file).toMatch(/auth:\s*"guest"/);
    }
  });
});

describe("in-person route contract", () => {
  it("every QR-token endpoint is public only with a rate limit, and never idempotency-stored", async () => {
    const root = path.resolve(process.cwd(), "src/app/api/in-person");
    const files = await routeFiles(root);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, file).toMatch(/auth:\s*"public"/);
      expect(source, file).toContain("rateLimit:");
      if (source.includes("export const POST")) {
        expect(source.includes("idempotent:") || source.includes('headers.get("idempotency-key")'), file).toBe(true);
      }
    }
  });

  it("does not put secret-bearing QR/code responses in the generic idempotency store", async () => {
    for (const relative of ["[id]/in-person/route.ts"]) {
      const source = await readFile(path.resolve(process.cwd(), "src/app/api/agreements", relative), "utf8");
      expect(source, relative).toContain('headers.get("idempotency-key")');
      expect(source, relative).not.toContain("idempotent:");
    }
    for (const relative of ["[token]/request/route.ts", "[token]/download-session/route.ts"]) {
      const source = await readFile(path.resolve(process.cwd(), "src/app/api/in-person", relative), "utf8");
      expect(source, relative).toContain('headers.get("idempotency-key")');
      expect(source, relative).not.toContain("idempotent:");
    }
  });

  it("the creator start/status/confirm endpoints require the user session", async () => {
    for (const relative of ["[id]/in-person/route.ts", "[id]/in-person/confirm/route.ts", "[id]/sign/route.ts"]) {
      const source = await readFile(path.resolve(process.cwd(), "src/app/api/agreements", relative), "utf8");
      expect(source, relative).toMatch(/auth:\s*"user"/);
      expect(source, relative).toContain("rateLimit:");
    }
  });

  it("binds the device with a __Host, httpOnly, SameSite=Strict cookie", () => {
    expect(DEVICE_COOKIE).toMatch(/^__Host-/);
    expect(deviceCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "strict", path: "/" });
  });
});

describe("public verification route contract", () => {
  it("is public, rate-limited, briefly cached and receives only a hash", async () => {
    const route = await readFile(path.resolve(process.cwd(), "src/app/api/public/verify/[sha256]/route.ts"), "utf8");
    expect(route).toMatch(/auth:\s*"public"/);
    expect(route).toContain("rateLimit:");
    expect(route).toContain('cacheControl: "public, max-age=60"');
    expect(route).not.toContain("request.body");
    const client = await readFile(path.resolve(process.cwd(), "src/app/verify/VerifyRecord.tsx"), "utf8");
    expect(client).toContain("hashFileLocally(file)");
    expect(client).not.toContain("FormData");
  });
});

describe("admin legal workflow contract", () => {
  it("uses server-equivalent blockers, explicit error state and forced reauthentication", async () => {
    const dashboard = await readFile(path.resolve(process.cwd(), "src/app/admin/AdminDashboard.tsx"), "utf8");
    expect(dashboard).toContain("legalDocumentApprovalBlockers");
    expect(dashboard).toContain('kind: "success" | "error"');
    expect(dashboard).toContain("/api/auth/login?intent=admin&fresh=1");
    const login = await readFile(path.resolve(process.cwd(), "src/app/api/auth/login/route.ts"), "utf8");
    expect(login).toContain('url.searchParams.get("fresh") === "1"');
  });
});

describe("redirect contract", () => {
  it("never builds redirects from request.url (container host behind the load balancer)", async () => {
    const root = path.resolve(process.cwd(), "src/app");
    for (const file of await routeFiles(root)) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(/Response\.redirect\(new URL\([^)]*request\.url/);
    }
  });
});
