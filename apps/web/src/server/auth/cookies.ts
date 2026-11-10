export const USER_COOKIE = "__Host-theckards_session";
export const ADMIN_COOKIE = "__Host-theckards_admin_session";
export const CSRF_COOKIE = "__Host-theckards_csrf";
export const AUTH_TRANSACTION_COOKIE = "__Host-theckards_auth_tx";

export const secureCookie = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

export const csrfCookie = {
  httpOnly: false,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
};
