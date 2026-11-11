import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Accessibility contracts that axe-core cannot see, measured in production on 2026-11-11 (docs/accessibility.md).
 * Each one failed before the fix that this file now protects.
 */
const appRoot = path.resolve(process.cwd(), "src/app");

async function files(directory: string, pattern: RegExp): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "api" ? Promise.resolve([]) : files(full, pattern);
    return Promise.resolve(pattern.test(entry.name) && !entry.name.includes(".test.") ? [full] : []);
  }));
  return nested.flat();
}

const relative = (file: string) => path.relative(appRoot, file);

describe("focus is never thrown away (WCAG 2.4.3)", () => {
  // `disabled={busy}` disables the control the person just used, and a disabled element cannot hold focus.
  // Measured before the fix: pressing "Verify hash" sent focus to BODY. Busy controls use components/Button.
  it("no control disables itself while its own action runs", async () => {
    const offenders: string[] = [];
    for (const file of await files(appRoot, /\.tsx$/)) {
      if (relative(file) === path.join("components", "Button.tsx")) continue;
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/(?<![-\w])disabled=\{([^}]*)\}/g)) {
        if (/\b(busy|uploading)\b/.test(match[1]!)) offenders.push(`${relative(file)}: disabled={${match[1]}}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("every page names itself (WCAG 2.4.2)", () => {
  it("gives each page its own title, without repeating the product name the layout appends", async () => {
    const titles = new Map<string, string>();
    for (const file of await files(appRoot, /^(page|not-found)\.tsx$/)) {
      const name = relative(file);
      if (name === "page.tsx") continue; // The home page uses the layout's default, "Theckards".
      const source = await readFile(file, "utf8");
      if (/export async function generateMetadata/.test(source)) continue;
      const title = /export const metadata = \{[^}]*?title: "([^"]+)"/.exec(source)?.[1];
      expect(title, `${name} has no title`).toBeDefined();
      expect(title, `${name} repeats the product name`).not.toMatch(/Theckards/);
      const clash = titles.get(title!);
      expect(clash, `${name} and ${clash} share the title "${title}"`).toBeUndefined();
      titles.set(title!, name);
    }
    expect(titles.size).toBeGreaterThanOrEqual(12);
  });
});

describe("colours in the stylesheet clear their contrast minimums", () => {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const ratio = (a: string, b: string) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high! + 0.05) / (low! + 0.05);
  };

  it("measures what it claims to", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("field borders 3:1, text 4.5:1 and the focus ring 3:1 against every background used", async () => {
    const css = await readFile(path.join(appRoot, "globals.css"), "utf8");
    const token = (name: string) => {
      const value = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1];
      expect(value, `--${name} must be a six-digit hex colour`).toBeDefined();
      return value!;
    };
    const notice = /\.notice \{[^}]*background: (#[0-9a-fA-F]{6})/.exec(css)?.[1];
    expect(notice).toBeDefined();
    const backgrounds = ["#ffffff", token("paper"), notice!];
    // The border colour is read from the stylesheet itself, so the field rule must use the token.
    expect(css).toMatch(/input, textarea, select \{[^}]*border: 1px solid var\(--field-line\)/);
    expect(css).toMatch(/:focus-visible \{[^}]*var\(--accent\)/);
    for (const background of backgrounds) {
      expect(ratio(token("field-line"), background), `field border on ${background}`).toBeGreaterThanOrEqual(3); // 1.4.11
      expect(ratio(token("muted"), background), `muted text on ${background}`).toBeGreaterThanOrEqual(4.5); // 1.4.3
      expect(ratio(token("ink"), background), `body text on ${background}`).toBeGreaterThanOrEqual(4.5); // 1.4.3
      expect(ratio(token("accent"), background), `focus ring on ${background}`).toBeGreaterThanOrEqual(3); // 2.4.7, 1.4.11
    }
  });

  it("lets long hashes wrap instead of widening the page (WCAG 1.4.10)", async () => {
    const css = await readFile(path.join(appRoot, "globals.css"), "utf8");
    expect(css).toMatch(/code \{[^}]*overflow-wrap: anywhere/);
  });

  // Inline `width: auto` beat the stylesheet and left the consent box at the browser's 13 px.
  it("lets the stylesheet size every checkbox and radio", async () => {
    const offenders: string[] = [];
    for (const file of await files(appRoot, /\.tsx$/)) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/<input\b[^>]*type="(checkbox|radio)"[^>]*>/g)) {
        if (/style=\{/.test(match[0])) offenders.push(`${relative(file)}: ${match[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
