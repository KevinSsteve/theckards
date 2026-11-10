import { z } from "zod";

const CurrencySchema = z.enum(["USD"]);

export const SettingsSchemas = {
  plans_limits: z.object({
    free: z.object({ monthlyAgreements: z.number().int().min(0).max(100), watermark: z.boolean() }),
    perAgreement: z.object({ amountCents: z.number().int().min(0).max(100_000), currency: CurrencySchema }),
    pro: z.object({ amountCents: z.number().int().min(0).max(1_000_000), currency: CurrencySchema, monthlyAgreements: z.number().int().min(1).max(10_000) }),
    inviteDailyFree: z.number().int().min(1).max(10_000),
    inviteDailyPro: z.number().int().min(1).max(100_000),
    uploadMaxBytes: z.number().int().min(1_048_576).max(26_214_400),
  }),
  auth: z.object({
    inviteValidityDays: z.number().int().min(1).max(30),
    otpValidityMinutes: z.number().int().min(2).max(30),
    otpMaxAttempts: z.number().int().min(1).max(10),
    userSessionHours: z.number().int().min(1).max(24),
    userIdleMinutes: z.number().int().min(5).max(240),
    adminSessionHours: z.number().int().min(1).max(8),
    adminIdleMinutes: z.number().int().min(5).max(30),
  }),
  ai: z.object({
    enabled: z.boolean(),
    provider: z.literal("bedrock"),
    modelId: z.string().min(3).max(200),
    fallbackModelId: z.string().min(3).max(200),
    timeoutMs: z.number().int().min(1_000).max(60_000),
    maxOutputTokens: z.number().int().min(100).max(8_000),
    dailyLimitFree: z.number().int().min(0).max(1_000),
    dailyLimitPaid: z.number().int().min(0).max(10_000),
  }),
  retention: z.object({
    logsDays: z.number().int().min(1).max(365),
    backupsDays: z.number().int().min(7).max(35),
    invitesDays: z.number().int().min(1).max(30),
    agreementsDays: z.number().int().min(1).nullable(),
    evidenceDays: z.number().int().min(1).nullable(),
    messagesDays: z.number().int().min(1).nullable(),
    signaturesDays: z.number().int().min(1).nullable(),
  }),
  email: z.object({
    from: z.string().email().endsWith("@theckards.linkealls.com"),
    replyTo: z.string().email().nullable(),
    locale: z.literal("en-US"),
  }),
  feature_flags: z.object({
    AI_ENABLED: z.boolean(),
    ANCHOR_ENABLED: z.boolean(),
    PUBLIC_PROFILE_ENABLED: z.boolean(),
    CUSTOM_TEMPLATES_ENABLED: z.boolean(),
    RESEAL_AFTER_PURCHASE: z.boolean(),
    SIGNUPS_ENABLED: z.boolean(),
    MAINTENANCE_MODE: z.boolean(),
    /** Email invitations, signing codes and receipt emails. Off while signing is in person only. */
    EMAIL_DELIVERY_ENABLED: z.boolean().default(false),
    ACTIVE_LOCALES: z.array(z.enum(["en-US", "es", "pt"])).min(1),
  }),
} as const;

export type SettingKey = keyof typeof SettingsSchemas;

export function isSettingKey(value: string): value is SettingKey {
  return Object.hasOwn(SettingsSchemas, value);
}

export function validateSetting(key: SettingKey, value: unknown): unknown {
  return SettingsSchemas[key].parse(value);
}
