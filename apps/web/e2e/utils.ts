/**
 * Shared E2E test utilities.
 */

/** True when a real (non-placeholder) Supabase backend is available. */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const hasSupabase = Boolean(supabaseUrl && supabaseAnonKey)
  && !supabaseUrl?.includes("placeholder")
  && !supabaseAnonKey?.includes("placeholder")
