import type { SettingKey } from "@theckards/domain";

export interface SettingDefinition {
  key: SettingKey;
  title: string;
  description: string;
  sensitive: boolean;
  requiresReauth: boolean;
}

export const settingsRegistry: readonly SettingDefinition[] = [
  { key: "plans_limits", title: "Plans & limits", description: "Prices, quotas, invitations and upload limits.", sensitive: true, requiresReauth: true },
  { key: "auth", title: "Authentication", description: "Invitation, OTP and session lifetime limits.", sensitive: true, requiresReauth: true },
  { key: "ai", title: "AI", description: "Bedrock models, timeout, token and daily limits.", sensitive: true, requiresReauth: true },
  { key: "retention", title: "Retention", description: "Retention rules by data category. Null means no automatic deletion.", sensitive: true, requiresReauth: true },
  { key: "email", title: "Email", description: "Verified sender and reply-to settings.", sensitive: false, requiresReauth: false },
  { key: "feature_flags", title: "Feature flags", description: "Runtime flags deployed through AWS AppConfig.", sensitive: true, requiresReauth: true },
] as const;
