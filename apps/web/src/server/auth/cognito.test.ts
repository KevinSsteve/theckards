import { describe, expect, it } from "vitest";
import { isPostLoginPath } from "./cognito";

const AGREEMENT = "/agreements/edfba75a-f6e6-435f-bd57-0b71180905da";

describe("where sign-in may send someone back to", () => {
  it("accepts the fixed pages and a single agreement page", () => {
    for (const path of ["/account", "/claim", AGREEMENT]) expect(isPostLoginPath(path), path).toBe(true);
  });

  // An open redirect would let a crafted sign-in link deliver a fresh session to another site's page.
  it("refuses anything that could leave the origin or reach another page", () => {
    for (const path of [
      "//evil.example", "https://evil.example", "/\\evil.example", "/agreements", "/agreements/", "/agreements/new",
      `${AGREEMENT}/extra`, `${AGREEMENT}?x=1`, `${AGREEMENT}#x`, `${AGREEMENT}/../../admin`, AGREEMENT.toUpperCase(),
      "/agreements/edfba75a-f6e6-435f-bd57-0b71180905d", "/admin", "/dashboard", " /account", "", null, undefined, 7,
    ]) expect(isPostLoginPath(path), String(path)).toBe(false);
  });
});
