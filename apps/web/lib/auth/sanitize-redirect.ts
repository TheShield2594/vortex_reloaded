/**
 * Validates that a path is a safe relative redirect target.
 * Rejects absolute URLs, protocol-relative URLs, and empty strings.
 */
export function sanitizeNextPath(raw: string): string {
  if (!raw || !/^\/(?!\/)/.test(raw) || raw.includes("://")) return "/"
  return raw
}
