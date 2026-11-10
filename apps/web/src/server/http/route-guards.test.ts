import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_COOKIE, AUTH_TRANSACTION_COOKIE, USER_COOKIE } from "../auth/cookies";

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
