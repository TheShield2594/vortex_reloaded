/**
 * Helper for accessing database tables not yet present in the generated
 * Supabase type definitions.
 *
 * Instead of scattering `(supabase as any).from("table")` across the codebase,
 * use `untypedFrom(supabase, "table")` to keep a single, auditable cast point.
 *
 * When the generated types are regenerated to include these tables, usages of
 * this helper should be migrated to the fully-typed `.from()` calls.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type AnySupabase = SupabaseClient<Database> | SupabaseClient

/**
 * Access a table that is not in the generated Database type.
 * Returns the same query builder as `supabase.from()` but without compile-time
 * column checking.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- single auditable cast point for untyped tables
export function untypedFrom(supabase: AnySupabase, table: string): ReturnType<SupabaseClient<any>["from"]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as SupabaseClient<any>).from(table)
}

/**
 * Call an RPC function that is not in the generated Database type.
 * Single auditable cast point for untyped RPCs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function untypedRpc(supabase: AnySupabase, fn: string, params?: Record<string, unknown>): ReturnType<SupabaseClient<any>["rpc"]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as SupabaseClient<any>).rpc(fn, params)
}
