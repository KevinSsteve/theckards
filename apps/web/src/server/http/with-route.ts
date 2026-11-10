import { canonicalJson } from "@theckards/domain";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { z } from "zod";
import { ADMIN_COOKIE, GUEST_COOKIE, USER_COOKIE } from "../auth/cookies";
import { verifyMutationRequest, verifyOrigin } from "../auth/csrf";
import { sha256 } from "../crypto";
import { loadGuestSession, loadSession, type GuestSession, type SessionIdentity } from "../auth/session-store";
import { enforceRateLimit, requestAddress } from "../rate-limit";
import { claimIdempotency, completeIdempotency, releaseIdempotency, type IdempotencyClaim } from "./idempotency";
import { ProblemError, problemResponse } from "./problem";

export interface RouteOptions<TSchema extends z.ZodTypeAny | undefined = undefined> {
  auth: "public" | "user" | "admin" | "guest";
  schema?: TSchema;
  rateLimit?: { scope: string; limit: number; windowSeconds: number };
  csrf?: boolean;
  ownerOnly?: boolean;
  idempotent?: string;
  /** Overrides the safe no-store default for explicitly public, non-sensitive GET responses. */
  cacheControl?: string;
}

export interface RouteInvocation<TBody = unknown> {
  request: Request;
  requestId: string;
  session: SessionIdentity | null;
  guest: GuestSession | null;
  body: TBody;
  params: Record<string, string>;
}

type Handler<TBody> = (invocation: RouteInvocation<TBody>) => Promise<Response> | Response;
type RouteContext = { params: Promise<Record<string, string>> };

export function withRoute<TSchema extends z.ZodTypeAny | undefined = undefined>(
  options: RouteOptions<TSchema>,
  handler: Handler<TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined>,
) {
  return async (request: Request, context: RouteContext): Promise<Response> => {
    const requestId = request.headers.get("x-request-id")?.slice(0, 128) || randomUUID();
    try {
      const jar = await cookies();
      let session: SessionIdentity | null = null;
      if (options.auth === "user") session = await loadSession(jar.get(USER_COOKIE)?.value, "USER");
      if (options.auth === "admin") session = await loadSession(jar.get(ADMIN_COOKIE)?.value, "ADMIN");
      const guest = options.auth === "guest" ? await loadGuestSession(jar.get(GUEST_COOKIE)?.value) : null;
      if ((options.auth === "user" || options.auth === "admin") && !session) throw new ProblemError(401, "Unauthorized", "A valid session is required.");
      if (options.auth === "guest" && !guest) throw new ProblemError(401, "Unauthorized", "A valid guest session is required.");
      if (options.auth === "admin") {
        if (!session?.groups.includes("admins") || !session.adminRole) throw new ProblemError(403, "Forbidden", "Administrator access is required.");
        if (options.ownerOnly && session.adminRole !== "OWNER") throw new ProblemError(403, "Forbidden", "Owner access is required.");
      }
      if (options.rateLimit) {
        await enforceRateLimit(options.rateLimit.scope, session?.userId ?? requestAddress(request), options.rateLimit.limit, options.rateLimit.windowSeconds);
      }
      const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
      if (isMutation && options.csrf !== false) {
        if (session) verifyMutationRequest(request, session);
        else if (guest) verifyMutationRequest(request, guest);
        else verifyOrigin(request);
      }
      const contentLength = Number(request.headers.get("content-length") ?? 0);
      if (contentLength > 1_048_576) throw new ProblemError(413, "Payload Too Large", "Request bodies are limited to 1 MB.");
      let body: unknown = undefined;
      if (options.schema) {
        let json: unknown;
        try { json = await request.json(); } catch { throw new ProblemError(400, "Bad Request", "A JSON request body is required."); }
        const parsed = options.schema.safeParse(json);
        if (!parsed.success) throw new ProblemError(422, "Validation Failed", "The request body is invalid.");
        body = parsed.data;
      }
      const params = await context.params;
      let idempotency: IdempotencyClaim | undefined;
      if (isMutation && options.idempotent) {
        const key = request.headers.get("idempotency-key");
        if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new ProblemError(400, "Idempotency-Key required", "Provide a valid Idempotency-Key header.");
        idempotency = {
          scope: `${options.idempotent}:${session?.userId ?? guest?.partyId ?? requestAddress(request)}`,
          key,
          requestHash: sha256(canonicalJson(body ?? null)),
        };
        const replay = await claimIdempotency(idempotency);
        if (replay) {
          const replayHeaders = new Headers(replay.headers);
          replayHeaders.set("x-request-id", requestId);
          replayHeaders.set("cache-control", "no-store");
          return new Response(replay.body, { status: replay.status, statusText: replay.statusText, headers: replayHeaders });
        }
      }
      let response: Response;
      try {
        response = await handler({ request, requestId, session, guest, body: body as never, params });
        if (idempotency) await completeIdempotency(idempotency, response);
      } catch (error) {
        if (idempotency) await releaseIdempotency(idempotency);
        throw error;
      }
      const headers = new Headers(response.headers);
      headers.set("x-request-id", requestId);
      headers.set("cache-control", options.cacheControl ?? "no-store");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      if (error instanceof Error && error.message === "Rate limit exceeded") return problemResponse(new ProblemError(429, "Too Many Requests", "Try again later."), requestId);
      if (error instanceof Error && error.message.startsWith("Invalid ")) return problemResponse(new ProblemError(403, "Forbidden", "The request could not be authorized."), requestId);
      return problemResponse(error, requestId);
    }
  };
}
