const USER_CONNECTIONS_MISSING_MESSAGES = [
  "Could not find the table 'public.user_connections' in the schema cache",
  'relation "public.user_connections" does not exist',
  'relation "user_connections" does not exist',
] as const

type SupabaseErrorLike = {
  code?: string
  message?: string
}

export function isUserConnectionsTableMissing(error: SupabaseErrorLike | null | undefined) {
  if (!error) return false
  if (error.code === "PGRST205" || error.code === "42P01") return true
  const message = error.message ?? ""
  return USER_CONNECTIONS_MISSING_MESSAGES.some((snippet) => message.includes(snippet))
}

export const USER_CONNECTIONS_SETUP_HINT =
  "Connections are not configured on this environment yet. Run Supabase migrations (`npx supabase db push`) and reload the Supabase API schema cache."

