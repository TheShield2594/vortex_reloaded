import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Route envelopes through a first-party endpoint so ad blockers
  // don't intercept requests to sentry.io
  tunnel: "/api/sentry-tunnel",
  tracesSampleRate: 0.05,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.replayIntegration(),
    Sentry.browserTracingIntegration({
      enableLongTask: true,
      enableInp: true,
      // Disable unused OpenTelemetry-based HTTP/fetch instrumentation that
      // adds ~317KB to the client bundle without benefit for browser tracing
      enableHTTPTimings: false,
    }),
  ],
  // Tree-shake unused OpenTelemetry integrations from the client bundle
  _experiments: {
    // Disable OTEL-based transport — use the lighter Sentry-native transport
    metricsAggregator: false,
  },
  enabled: process.env.NODE_ENV === "production",
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
