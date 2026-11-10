import { describe, expect, it } from "vitest";
import { accountLinkState } from "./InPersonSigner";

/**
 * A counterparty who signs in person has no account. Linking the agreement to one is the only way they keep
 * access to the record afterwards, and it is possible only on the signing device, for a short window. The offer
 * was previously hidden behind pressing "Get the sealed PDF", so signing and pocketing the phone cost the
 * counterparty the record permanently. These assertions pin when the offer is shown.
 */
describe("the offer to keep access with an account", () => {
  it("is shown as soon as the record is sealed, with or without the download", () => {
    expect(accountLinkState({ status: "COMPLETED", sealed: true, downloadReady: true }, false)).toBe("needs-session");
    expect(accountLinkState({ status: "COMPLETED", sealed: true, downloadReady: true }, true)).toBe("ready");
  });

  it("claims the short session first when the signer has not fetched the sealed copy", () => {
    expect(accountLinkState({ status: "COMPLETED", sealed: true, downloadReady: true }, false)).toBe("needs-session");
  });

  it("goes straight to sign-in when the session was already issued on this device", () => {
    expect(accountLinkState({ status: "COMPLETED", sealed: true, downloadReady: false }, true)).toBe("ready");
    expect(accountLinkState({ status: "COMPLETED", sealed: true, downloadReady: false }, false)).toBe("ready");
  });

  it("stays hidden until both parties have signed and the record is sealed", () => {
    expect(accountLinkState({ status: "OPEN", expiresAt: "2026-11-10T22:19:00Z" }, false)).toBe("hidden");
    expect(accountLinkState({ status: "AWAITING_CONFIRMATION", expiresAt: "2026-11-10T22:19:00Z" }, false)).toBe("hidden");
    expect(accountLinkState({ status: "COMPLETED", sealed: false, downloadReady: false }, false)).toBe("hidden");
    expect(accountLinkState({ status: "UNAVAILABLE" }, true)).toBe("hidden");
  });
});
