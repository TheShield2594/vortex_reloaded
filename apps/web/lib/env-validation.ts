/**
 * Validates required environment variables at server startup.
 * Import this at the top of instrumentation.ts so it runs before any requests.
 *
 * Logs warnings for optional variables that enable specific features, and
 * throws for variables that are unconditionally required.
 */

interface EnvVar {
  name: string
  required: boolean
  /** Short description shown in the warning/error message */
  description: string
  /** Alternative env var name that satisfies the same requirement (e.g. server-side alias) */
  alternativeName?: string
}

const REQUIRED: EnvVar[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", required: true, description: "Supabase project URL" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true, description: "Supabase anon key" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", required: true, description: "Supabase service role key (server-side)" },
]

const OPTIONAL: EnvVar[] = [
  { name: "NEXT_PUBLIC_APP_URL", required: false, description: "Public app URL (e.g. https://your-app.vercel.app) — used in web push payloads" },
  { name: "CRON_SECRET", required: false, description: "Secret for authenticating cron job requests — required for cleanup/poll cron endpoints" },
  { name: "NEXT_PUBLIC_SENTRY_DSN", required: false, description: "Sentry DSN for error monitoring (highly recommended in production)" },
  { name: "UPSTASH_REDIS_REST_URL", required: false, description: "Upstash Redis URL for distributed rate limiting (required for multi-instance deployments)" },
  { name: "UPSTASH_REDIS_REST_TOKEN", required: false, description: "Upstash Redis token" },
  { name: "TURN_URL", required: false, description: "TURN server URL for WebRTC NAT traversal (~20% of users need this)" },
  { name: "TURN_SECRET", required: false, description: "coturn static-auth-secret for ephemeral TURN credentials" },
  { name: "NEXT_PUBLIC_VAPID_PUBLIC_KEY", required: false, description: "VAPID public key for web push notifications" },
  { name: "VAPID_PRIVATE_KEY", required: false, description: "VAPID private key for web push notifications" },
  { name: "LIVEKIT_API_KEY", required: false, description: "LiveKit API key for voice channels" },
  { name: "LIVEKIT_API_SECRET", required: false, description: "LiveKit API secret for voice channels" },
  { name: "NEXT_PUBLIC_LIVEKIT_URL", required: false, description: "LiveKit server URL" },

  { name: "NEXT_PUBLIC_KLIPY_API_KEY", required: false, description: "Klipy API key for GIF/sticker picker (primary provider)", alternativeName: "KLIPY_API_KEY" },
  { name: "NEXT_PUBLIC_GIPHY_API_KEY", required: false, description: "Giphy API key for GIF picker (fallback)", alternativeName: "GIPHY_API_KEY" },
  { name: "STEP_UP_SECRET", required: false, description: "Dedicated HMAC secret for step-up auth tokens — required in production (must not reuse NEXTAUTH_SECRET)" },
]

export function validateEnv() {
  // Only run on the server
  if (typeof window !== "undefined") return

  const missing: string[] = []
  for (const v of REQUIRED) {
    if (!process.env[v.name]) {
      missing.push(`  ${v.name} — ${v.description}`)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.join("\n")}\n\n` +
      "See apps/web/.env.local.example for setup instructions."
    )
  }

  // Warn about optional vars that enable important features
  const missingOptional: string[] = []
  for (const v of OPTIONAL) {
    if (!process.env[v.name] && !(v.alternativeName && process.env[v.alternativeName])) {
      missingOptional.push(`  ${v.name} — ${v.description}`)
    }
  }

  if (missingOptional.length > 0 && process.env.NODE_ENV === "production") {
    console.warn(
      "[env] The following optional environment variables are not set. " +
      "Related features will be unavailable or degraded:\n" +
      missingOptional.join("\n")
    )
  }

  // Fail fast in production for secrets that must not be omitted.
  // Skip when SKIP_STRICT_ENV_VALIDATION is set (CI build/E2E with placeholder secrets).
  const skipStrict = process.env.SKIP_STRICT_ENV_VALIDATION === "true"
  if (process.env.NODE_ENV === "production" && !skipStrict && !process.env.STEP_UP_SECRET) {
    throw new Error(
      "STEP_UP_SECRET must be set in production. " +
      "Generate a dedicated 256-bit secret: openssl rand -hex 32"
    )
  }
}
