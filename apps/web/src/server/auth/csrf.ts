import { env } from "../env";
import { hmac, equalHex } from "../crypto";

export function verifyOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin !== env().APP_BASE_URL) throw new Error("Invalid request origin");
}

export function verifyMutationRequest(request: Request, session: { csrfHash: string }): void {
  verifyOrigin(request);
  const token = request.headers.get("x-csrf-token");
  if (!token || !equalHex(hmac(token, "auth"), session.csrfHash)) throw new Error("Invalid CSRF token");
}
