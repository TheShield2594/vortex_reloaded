/**
 * Drizzle result rows use camelCase JS properties (matching the schema's
 * column definitions); every API response/prop contract in this app was
 * frozen against Supabase's raw snake_case PostgREST output (see
 * types/database.ts) and never rewritten. Converting at the DB boundary
 * keeps every existing route/response shape and frontend consumer intact
 * as routes move off supabase-js.
 */
function toSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

/** Deep-converts every plain-object key from camelCase to snake_case. Arrays and non-plain values pass through untouched. */
export function toSnakeCase<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) {
    return value.map((item) => toSnakeCase(item)) as T
  }
  if (value !== null && typeof value === "object" && value.constructor === Object) {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[toSnakeKey(key)] = toSnakeCase(val)
    }
    return result as T
  }
  return value as T
}
