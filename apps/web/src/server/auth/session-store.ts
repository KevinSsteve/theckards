import type pg from "pg";
import type { AdminRole, SessionKind } from "@theckards/domain";
import { DEFAULT_SESSION_POLICY } from "@theckards/domain";
import { decryptText, encryptText, hmac, randomToken } from "../crypto";
import { getPool, inTransaction } from "../db";

export interface SessionIdentity {
  sessionHash: string;
  userId: string;
  cognitoSub: string;
  kind: SessionKind;
  groups: readonly string[];
  csrfHash: string;
  recentAuthAt: Date;
  accessTokenCiphertext: Uint8Array | null;
  adminRole: AdminRole | null;
}

export interface NewIdentity {
  sub: string;
  email: string;
  groups: readonly string[];
  accessToken: string;
  refreshToken?: string;
  authTime: Date;
}

export async function upsertUser(identity: Pick<NewIdentity, "sub" | "email">): Promise<string> {
  const encryptedEmail = await encryptText(identity.email.toLowerCase(), "user-email");
  const emailHash = hmac(identity.email.trim().toLowerCase(), "email");
  const result = await getPool().query<{ id: string; state: string }>(`
    INSERT INTO users(cognito_sub, email_ciphertext, email_hash)
    VALUES ($1, $2, $3)
    ON CONFLICT (cognito_sub) DO UPDATE SET
      email_ciphertext = EXCLUDED.email_ciphertext,
      email_hash = EXCLUDED.email_hash,
      updated_at = now()
    RETURNING id, state
  `, [identity.sub, encryptedEmail, emailHash]);
  const user = result.rows[0];
  if (!user || user.state !== "ACTIVE") throw new Error("Account is not active");
  return user.id;
}

export async function createSession(
  identity: NewIdentity,
  kind: Extract<SessionKind, "USER" | "ADMIN">,
): Promise<{ token: string; csrf: string; absoluteExpiresAt: Date }> {
  const userId = await upsertUser(identity);
  const token = randomToken();
  const csrf = randomToken();
  const policy = DEFAULT_SESSION_POLICY;
  const hours = kind === "ADMIN" ? policy.adminSessionHours : policy.userSessionHours;
  const idle = kind === "ADMIN" ? policy.adminIdleMinutes : policy.userIdleMinutes;
  const absoluteExpiresAt = new Date(Date.now() + hours * 3_600_000);
  const inactivityExpiresAt = new Date(Date.now() + idle * 60_000);
  const access = await encryptText(identity.accessToken, "cognito-access-token");
  const refresh = identity.refreshToken ? await encryptText(identity.refreshToken, "cognito-refresh-token") : null;
  await getPool().query(`
    INSERT INTO sessions(
      session_hash, user_id, kind, groups, csrf_hash, access_token_ciphertext,
      refresh_token_ciphertext, inactivity_expires_at, absolute_expires_at, recent_auth_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [hmac(token, "auth"), userId, kind, identity.groups, hmac(csrf, "auth"), access, refresh, inactivityExpiresAt, absoluteExpiresAt, identity.authTime]);
  return { token, csrf, absoluteExpiresAt };
}

export async function loadSession(token: string | undefined, expectedKind: Extract<SessionKind, "USER" | "ADMIN">): Promise<SessionIdentity | null> {
  if (!token) return null;
  const result = await getPool().query<{
    session_hash: string; user_id: string; cognito_sub: string; kind: SessionKind; groups: string[];
    csrf_hash: string; recent_auth_at: Date; access_token_ciphertext: Uint8Array | null;
    state: string; admin_role: AdminRole | null;
  }>(`
    SELECT s.session_hash, s.user_id, u.cognito_sub, s.kind, s.groups, s.csrf_hash,
           s.recent_auth_at, s.access_token_ciphertext, u.state, au.role AS admin_role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN admin_users au ON au.user_id = u.id AND au.state = 'ACTIVE'
    WHERE s.session_hash = $1 AND s.kind = $2 AND s.revoked_at IS NULL
      AND s.absolute_expires_at > now() AND s.inactivity_expires_at > now()
  `, [hmac(token, "auth"), expectedKind]);
  const row = result.rows[0];
  if (!row || row.state !== "ACTIVE") return null;
  const idleMinutes = expectedKind === "ADMIN" ? DEFAULT_SESSION_POLICY.adminIdleMinutes : DEFAULT_SESSION_POLICY.userIdleMinutes;
  await getPool().query(
    "UPDATE sessions SET last_seen_at = now(), inactivity_expires_at = now() + ($2::text || ' minutes')::interval WHERE session_hash = $1",
    [row.session_hash, idleMinutes],
  );
  return {
    sessionHash: row.session_hash,
    userId: row.user_id,
    cognitoSub: row.cognito_sub,
    kind: row.kind,
    groups: row.groups,
    csrfHash: row.csrf_hash,
    recentAuthAt: row.recent_auth_at,
    accessTokenCiphertext: row.access_token_ciphertext,
    adminRole: row.admin_role,
  };
}

export async function isAllowedAdmin(userId: string): Promise<boolean> {
  const allowed = await getPool().query("SELECT 1 FROM admin_users WHERE user_id = $1 AND state = 'ACTIVE'", [userId]);
  return allowed.rowCount === 1;
}

export async function requirePendingAdmin(session: SessionIdentity): Promise<void> {
  if (!session.groups.includes("admins")) throw new Error("Cognito administrators group required");
  if (!(await isAllowedAdmin(session.userId))) throw new Error("Administrator is not allow-listed");
}

export async function getSessionAccessToken(session: SessionIdentity): Promise<string> {
  if (!session.accessTokenCiphertext) throw new Error("Session has no Cognito access token");
  return decryptText(session.accessTokenCiphertext, "cognito-access-token");
}

export async function revokeSession(sessionHash: string): Promise<void> {
  await getPool().query("UPDATE sessions SET revoked_at = now() WHERE session_hash = $1 AND revoked_at IS NULL", [sessionHash]);
}

export async function revokeToken(token: string | undefined): Promise<void> {
  if (!token) return;
  await getPool().query("UPDATE sessions SET revoked_at = now() WHERE session_hash = $1 AND revoked_at IS NULL", [hmac(token, "auth")]);
}

export async function registerOwner(cognitoSub: string): Promise<void> {
  await inTransaction(async (client: pg.PoolClient) => {
    const user = await client.query<{ id: string }>("SELECT id FROM users WHERE cognito_sub = $1 FOR UPDATE", [cognitoSub]);
    const id = user.rows[0]?.id;
    if (!id) throw new Error("Owner must sign in once before registration");
    await client.query("INSERT INTO admin_users(user_id, role, created_by) VALUES ($1, 'OWNER', $1) ON CONFLICT (user_id) DO UPDATE SET role = 'OWNER', state = 'ACTIVE'", [id]);
  });
}

export interface GuestSession {
  sessionHash: string;
  agreementId: string;
  partyId: string;
  csrfHash: string;
}

const GUEST_SESSION_HOURS = 2;
const GUEST_IDLE_MINUTES = 30;

export async function createGuestSession(
  client: pg.PoolClient, agreementId: string, partyId: string,
  credentials?: { token: string; csrf: string },
): Promise<{ token: string; csrf: string; absoluteExpiresAt: Date }> {
  const token = credentials?.token ?? randomToken();
  const csrf = credentials?.csrf ?? randomToken();
  const absoluteExpiresAt = new Date(Date.now() + GUEST_SESSION_HOURS * 3_600_000);
  const sessionHash = hmac(token, "auth");
  await client.query(`
    INSERT INTO sessions(session_hash, user_id, kind, groups, csrf_hash, inactivity_expires_at, absolute_expires_at, recent_auth_at, guest_agreement_id, guest_party_id)
    VALUES ($1, NULL, 'GUEST', '{}', $2, now() + ($3::text || ' minutes')::interval, $4, now(), $5, $6)
    ON CONFLICT (session_hash) DO NOTHING
  `, [sessionHash, hmac(csrf, "auth"), GUEST_IDLE_MINUTES, absoluteExpiresAt, agreementId, partyId]);
  const stored = await client.query<{ absolute_expires_at: Date }>(
    "SELECT absolute_expires_at FROM sessions WHERE session_hash = $1 AND kind = 'GUEST' AND guest_agreement_id = $2 AND guest_party_id = $3",
    [sessionHash, agreementId, partyId],
  );
  if (!stored.rows[0]) throw new Error("Guest session could not be created");
  return { token, csrf, absoluteExpiresAt: stored.rows[0].absolute_expires_at };
}

export async function loadGuestSession(token: string | undefined): Promise<GuestSession | null> {
  if (!token) return null;
  const result = await getPool().query<{ session_hash: string; guest_agreement_id: string; guest_party_id: string; csrf_hash: string }>(`
    SELECT session_hash, guest_agreement_id, guest_party_id, csrf_hash FROM sessions
    WHERE session_hash = $1 AND kind = 'GUEST' AND revoked_at IS NULL
      AND absolute_expires_at > now() AND inactivity_expires_at > now()
  `, [hmac(token, "auth")]);
  const row = result.rows[0];
  if (!row) return null;
  await getPool().query(
    "UPDATE sessions SET last_seen_at = now(), inactivity_expires_at = LEAST(absolute_expires_at, now() + ($2::text || ' minutes')::interval) WHERE session_hash = $1",
    [row.session_hash, GUEST_IDLE_MINUTES],
  );
  return { sessionHash: row.session_hash, agreementId: row.guest_agreement_id, partyId: row.guest_party_id, csrfHash: row.csrf_hash };
}
