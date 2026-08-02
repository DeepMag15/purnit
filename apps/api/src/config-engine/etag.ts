/**
 * Matches a raw etag value against a request's `If-None-Match` header.
 * Handles the quoted form (`"abc123"`, what we actually emit) and, since
 * some clients send a comma-separated list of candidates, checks each one.
 * Does not implement the `*` wildcard — that's an `If-Match` (conditional
 * write) concern, not relevant to the GET endpoints this guards.
 */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const quoted = `"${etag}"`;
  return ifNoneMatch
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === quoted || candidate === etag);
}
