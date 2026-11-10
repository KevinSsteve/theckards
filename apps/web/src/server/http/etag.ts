import { ProblemError } from "./problem";

export function readIfMatch(request: Request): number {
  const value = request.headers.get("if-match");
  const match = value?.match(/^(?:W\/)?"?(\d+)"?$/);
  if (!match) throw new ProblemError(428, "Precondition Required", "Provide the current agreement version in the If-Match header.");
  return Number(match[1]);
}

export function etag(version: number): string {
  return `"${version}"`;
}
