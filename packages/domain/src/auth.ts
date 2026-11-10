import { z } from "zod";

export const UserStateSchema = z.enum(["ACTIVE", "SUSPENDED", "DELETED"]);
export type UserState = z.infer<typeof UserStateSchema>;

export const SessionKindSchema = z.enum(["USER", "ADMIN", "GUEST"]);
export type SessionKind = z.infer<typeof SessionKindSchema>;

export const AdminRoleSchema = z.enum(["OWNER", "SUPPORT"]);
export type AdminRole = z.infer<typeof AdminRoleSchema>;

export const SessionPolicySchema = z.object({
  userSessionHours: z.number().int().min(1).max(24),
  userIdleMinutes: z.number().int().min(5).max(240),
  adminSessionHours: z.number().int().min(1).max(8),
  adminIdleMinutes: z.number().int().min(5).max(30),
});

export const DEFAULT_SESSION_POLICY = {
  userSessionHours: 12,
  userIdleMinutes: 30,
  adminSessionHours: 4,
  adminIdleMinutes: 15,
} as const;
