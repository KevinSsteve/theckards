export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail: string,
    readonly type = "about:blank",
  ) {
    super(detail);
    this.name = "ProblemError";
  }
}

export function problemResponse(error: unknown, requestId: string): Response {
  const problem = error instanceof ProblemError
    ? error
    : new ProblemError(500, "Internal Server Error", "The request could not be completed.");
  if (!(error instanceof ProblemError)) {
    console.error(JSON.stringify({ level: "error", msg: "request failed", requestId, error: error instanceof Error ? error.name : "unknown" }));
  }
  return Response.json(
    { type: problem.type, title: problem.title, status: problem.status, detail: problem.detail, request_id: requestId },
    { status: problem.status, headers: { "content-type": "application/problem+json", "x-request-id": requestId, "cache-control": "no-store" } },
  );
}
