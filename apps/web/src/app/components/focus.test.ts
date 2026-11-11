import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every element that receives focus from `useFocusAfter` must be able to take it. A heading, paragraph or list
 * item is not focusable unless it carries tabIndex={-1}, and `focus()` on it silently does nothing, which would
 * leave focus on BODY exactly as before the fix. Controls (input, textarea, button, a) are focusable already.
 */
const appRoot = path.resolve(process.cwd(), "src/app");

async function tsx(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? tsx(full) : Promise.resolve(entry.name.endsWith(".tsx") ? [full] : []);
  }));
  return nested.flat();
}

describe("focus targets can take focus", () => {
  it("gives every non-control focus target tabIndex={-1}", async () => {
    const checked: string[] = [];
    for (const file of await tsx(appRoot)) {
      const source = await readFile(file, "utf8");
      const targets = [...source.matchAll(/const (\w+) = useFocusAfter<HTML(\w+)Element>/g)];
      for (const [, name, type] of targets) {
        const control = ["Input", "TextArea", "Button", "Anchor", "Select"].includes(type!);
        // The ref is either attached directly or spread with tabIndex in the same object.
        const attached = new RegExp(`ref(=\\{|: )${name}\\b[^>]*`).exec(source)?.[0] ?? "";
        expect(attached, `${path.basename(file)}: ${name} is created but never attached`).not.toBe("");
        if (!control) expect(attached, `${path.basename(file)}: ${name} (${type}) needs tabIndex -1`).toMatch(/tabIndex(=\{|: )-1/);
        checked.push(`${path.basename(file)}:${name}`);
      }
    }
    // If this finds nothing, the scan broke rather than the focus targets disappearing.
    expect(checked.length).toBeGreaterThanOrEqual(8);
  });
});
