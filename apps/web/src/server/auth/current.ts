import { cookies } from "next/headers";
import { ADMIN_COOKIE, USER_COOKIE } from "./cookies";
import { loadSession, type SessionIdentity } from "./session-store";

export async function currentUserSession(): Promise<SessionIdentity | null> {
  const jar = await cookies();
  return loadSession(jar.get(USER_COOKIE)?.value, "USER");
}

export async function currentAdminSession(): Promise<SessionIdentity | null> {
  const jar = await cookies();
  const session = await loadSession(jar.get(ADMIN_COOKIE)?.value, "ADMIN");
  if (!session || !session.groups.includes("admins") || !session.adminRole) return null;
  return session;
}
