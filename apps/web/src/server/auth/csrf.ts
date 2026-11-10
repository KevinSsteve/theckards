import { env } from "../env";
import { hmac, equalHex } from "../crypto";
import type { SessionIdentity } from "./session-store";

export function verifyMutationRequest(request: Request, session: SessionIdentity): void {
  const origin = request.headers.get("origin");
  if (origin !== env().APP_BASE_URL) throw new Error("Invalid request origin");
  const token = request.headers.get("x-csrf-token");
  if (!token || !equalHex(hmac(token, "auth"), session.csrfHash)) throw new Error("Invalid CSRF token");
}
