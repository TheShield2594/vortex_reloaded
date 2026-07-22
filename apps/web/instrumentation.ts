import * as Sentry from "@sentry/nextjs"

export async function register() {
  // Only validate on the server (Node.js runtime), not in the Edge runtime or browser
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./lib/env-validation")
    validateEnv()

    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.05,
      enabled: process.env.NODE_ENV === "production",
    })
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.05,
      enabled: process.env.NODE_ENV === "production",
    })
  }
}

export const onRequestError = Sentry.captureRequestError
