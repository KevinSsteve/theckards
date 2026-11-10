import { describe, expect, it } from "vitest";
import { SettingsSchemas, isSettingKey, validateSetting } from "./settings.js";

describe("settings", () => {
  it("recognizes only registered keys", () => {
    expect(isSettingKey("ai")).toBe(true);
    expect(isSettingKey("unknown")).toBe(false);
  });

  it("rejects unsafe upload sizes", () => {
    const value = {
      free: { monthlyAgreements: 2, watermark: true },
      perAgreement: { amountCents: 499, currency: "USD" },
      pro: { amountCents: 1900, currency: "USD", monthlyAgreements: 30 },
      inviteDailyFree: 20,
      inviteDailyPro: 200,
      uploadMaxBytes: 50_000_000,
    };
    expect(() => validateSetting("plans_limits", value)).toThrow();
  });

  it("keeps dangerous flags off in a minimal configuration", () => {
    const value = SettingsSchemas.feature_flags.parse({
      AI_ENABLED: true,
      ANCHOR_ENABLED: false,
      PUBLIC_PROFILE_ENABLED: false,
      CUSTOM_TEMPLATES_ENABLED: false,
      RESEAL_AFTER_PURCHASE: false,
      SIGNUPS_ENABLED: true,
      MAINTENANCE_MODE: false,
      ACTIVE_LOCALES: ["en-US"],
    });
    expect(value.ANCHOR_ENABLED).toBe(false);
    expect(value.PUBLIC_PROFILE_ENABLED).toBe(false);
  });
});
