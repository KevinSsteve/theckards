import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { z } from "zod";
import { ADMIN_COOKIE, USER_COOKIE } from "../auth/cookies";
import { verifyMutationRequest } from "../auth/csrf";
import { loadSession, type SessionIdentity } from "../auth/session-store";
import { enforceRateLimit, requestAddress } from "../rate-limit";
import { ProblemError, problemResponse } from "./problem";

export interface RouteOptions<TSchema extends z.ZodTypeAny | undefined = undefined> {
  auth: "public" | "user" | "admin";
  schema?: TSchema;
  rateLimit?: { scope: string; limit: number; windowSeconds: number };
  csrf?: boolean;
  ownerOnly?: boolean;
}

export interface RouteInvocation<TBody = unknown> {
  request: Request;
  requestId: string;
  session: SessionIdentity | null;
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
      if (options.auth !== "public" && !session) throw new ProblemError(401, "Unauthorized", "A valid session is required.");
      if (options.auth === "admin") {
        if (!session?.groups.includes("admins") || !session.adminRole) throw new ProblemError(403, "Forbidden", "Administrator access is required.");
        if (options.ownerOnly && session.adminRole !== "OWNER") throw new ProblemError(403, "Forbidden", "Owner access is required.");
      }
      if (options.rateLimit) {
        await enforceRateLimit(options.rateLimit.scope, session?.userId ?? requestAddress(request), options.rateLimit.limit, options.rateLimit.windowSeconds);
      }
      const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
      if (isMutation && options.auth !== "public" && options.csrf !== false && session) verifyMutationRequest(request, session);
      let body: unknown = undefined;
      if (options.schema) {
        let json: unknown;
        try { json = await request.json(); } catch { throw new ProblemError(400, "Bad Request", "A JSON request body is required."); }
        const parsed = options.schema.safeParse(json);
        if (!parsed.success) throw new ProblemError(422, "Validation Failed", "The request body is invalid.");
        body = parsed.data;
      }
      const params = await context.params;
      const response = await handler({ request, requestId, session, body: body as never, params });
      const headers = new Headers(response.headers);
      headers.set("x-request-id", requestId);
      headers.set("cache-control", "no-store");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      if (error instanceof Error && error.message === "Rate limit exceeded") return problemResponse(new ProblemError(429, "Too Many Requests", "Try again later."), requestId);
      if (error instanceof Error && error.message.startsWith("Invalid ")) return problemResponse(new ProblemError(403, "Forbidden", "The request could not be authorized."), requestId);
      return problemResponse(error, requestId);
    }
  };
}
