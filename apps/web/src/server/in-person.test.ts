import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getPool: () => { throw new Error("not used"); }, inTransaction: () => { throw new Error("not used"); } }));
vi.mock("./crypto", () => ({
  hmac: (value: string) => Buffer.from(value).toString("hex").padEnd(64, "0").slice(0, 64),
  equalHex: (a: string, b: string) => a === b,
  randomToken: () => "t",
}));
vi.mock("./signing", () => ({}));
vi.mock("./legal", () => ({}));
vi.mock("./auth/session-store", () => ({}));
const { counterpartyView, deviceMatches } = await import("./in-person");
const { hmac } = await import("./crypto");
type Context = NonNullable<Parameters<typeof counterpartyView>[0]>;

const device = "device-secret-of-the-signer";
const base: Context = {
  sessionId: "s1", agreementId: "a1", status: "OPEN", expiresAt: new Date(Date.now() + 60_000), codeExpiresAt: null, deviceHash: null,
  typedName: null, completedAt: null, guestSessionIssuedAt: null, partyId: null, isCurrentVersion: true,
  agreementState: "PENDING_SIGNATURES", title: "T", versionNumber: 1, documentS3Key: "k", sections: [], creatorSignedName: "A",
};
const bound = (patch: Partial<Context>): Context => ({ ...base, deviceHash: hmac(`in-person-device:${device}`, "auth"), ...patch });

describe("in-person QR access (IDOR)", () => {
  it("shows an open, live session to whoever holds the token", () => {
    expect(counterpartyView(base, undefined).status).toBe("OPEN");
  });
  it("hides an expired, superseded or non-pending session", () => {
    expect(counterpartyView({ ...base, expiresAt: new Date(Date.now() - 1) }, undefined).status).toBe("UNAVAILABLE");
    expect(counterpartyView({ ...base, isCurrentVersion: false }, undefined).status).toBe("UNAVAILABLE");
    expect(counterpartyView({ ...base, agreementState: "CANCELLED" }, undefined).status).toBe("UNAVAILABLE");
    expect(counterpartyView({ ...base, status: "CANCELLED" }, undefined).status).toBe("UNAVAILABLE");
    expect(counterpartyView(null, device).status).toBe("UNAVAILABLE");
  });
  it("once claimed, only the signing device sees the session", () => {
    const awaiting = bound({ status: "AWAITING_CONFIRMATION" });
    expect(deviceMatches(awaiting, device)).toBe(true);
    expect(counterpartyView(awaiting, device).status).toBe("AWAITING_CONFIRMATION");
    expect(counterpartyView(awaiting, "another-device").status).toBe("UNAVAILABLE");
    expect(counterpartyView(awaiting, undefined).status).toBe("UNAVAILABLE");
  });
  it("offers the sealed download only to the signing device, once, within the window", () => {
    const done = bound({ status: "COMPLETED", completedAt: new Date(), partyId: "p2" });
    expect(counterpartyView(done, device, true)).toEqual({ status: "COMPLETED", sealed: true, downloadReady: true });
    expect(counterpartyView(done, "another-device", true).status).toBe("UNAVAILABLE");
    expect(counterpartyView({ ...done, guestSessionIssuedAt: new Date() }, device, true)).toEqual({ status: "COMPLETED", sealed: true, downloadReady: false });
    expect(counterpartyView({ ...done, completedAt: new Date(Date.now() - 3 * 3_600_000) }, device, true).status).toBe("UNAVAILABLE");
  });
});

describe("wrong-code attempt counter (regression)", () => {
  it("casts the reused attempts parameter so PostgreSQL can type it and the limit is enforced", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new globalThis.URL("./in-person.ts", import.meta.url), "utf8");
    expect(source).toContain("SET attempts = $2::int, status = CASE WHEN $2::int >= $3::int");
    expect(source).not.toMatch(/SET attempts = \$2, status = CASE WHEN \$2 >=/);
  });
});
