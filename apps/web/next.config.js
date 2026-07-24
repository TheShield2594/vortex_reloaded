const { withSentryConfig } = require("@sentry/nextjs")
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Service worker must always be fresh — no caching
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Cache icons for 1 day so updates propagate within 24h
        source: "/icon-:slug.png",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=3600" },
        ],
      },
      {
        source: "/apple-touch-icon.png",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=3600" },
        ],
      },
      {
        source: "/favicon-:slug.png",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=3600" },
        ],
      },
      {
        source: "/favicon.ico",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=3600" },
        ],
      },
      {
        source: "/startup/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Manifest should refresh periodically
        source: "/manifest.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            // Allow microphone for voice channels; deny camera, geolocation, payment
            value: "camera=(self), microphone=(self), geolocation=(), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // CSP is set dynamically per-request in proxy.ts with nonce-based script-src
          // (see proxy.ts buildCsp() — no unsafe-eval or unsafe-inline for scripts)
        ],
      },
    ]
  },
  images: {
    // Avatars and attachments are served same-origin from /api/avatars and
    // /api/dm/attachments (local disk, see resolveUploadsDir in @vortex/db),
    // so no external image hosts need to be allow-listed here.
    remotePatterns: [],
  },
  eslint: {
    // ESLint linting is run separately via `eslint .` — skip during `next build`
    // to avoid a workspace hoisting issue with minimatch versions
    ignoreDuringBuilds: true,
  },
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,
  transpilePackages: ['@vortex/shared'],
  // better-sqlite3 (via @vortex/db, used by Better Auth's drizzle adapter —
  // see lib/auth/better-auth.ts) is a native addon. This alone isn't
  // enough to keep it out of the server bundle in this workspace (it's
  // required through a raw-TypeScript workspace package rather than a
  // pre-built node_modules entry point) — see the `eval("require")` in
  // packages/db/src/client.ts for the fix that actually prevents webpack
  // from bundling it. Kept here too as a harmless, standard safety net.
  serverExternalPackages: ['better-sqlite3'],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // @matrix-org/olm's UMD build (lib/olm-protocol.ts's dynamic
      // import("@matrix-org/olm")) branches on `typeof require === "function"`
      // to support both Node and browser, but webpack still statically sees
      // the `require("fs")`/`require("path")` calls in that Node branch and
      // tries to resolve them for the client bundle — neither is polyfilled
      // (or needed; that branch never runs in the browser), so the build
      // fails with "Module not found: Can't resolve 'fs'" otherwise. `false`
      // tells webpack to stub these out instead of erroring.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      }

      // Split heavy client-side dependencies into separate chunks
      // so the initial bundle stays small on low-end mobile devices
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        cacheGroups: {
          ...config.optimization.splitChunks?.cacheGroups,
          livekit: {
            test: /[\\/]node_modules[\\/](livekit-client|@livekit)[\\/]/,
            name: "livekit",
            chunks: "all",
            priority: 30,
          },
          sentry: {
            test: /[\\/]node_modules[\\/]@sentry[\\/]/,
            name: "sentry",
            chunks: "all",
            priority: 20,
          },
        },
      }
    }
    return config
  },
}

module.exports = withBundleAnalyzer(withSentryConfig(nextConfig, {
  silent: true,
  // Only upload source maps in CI to avoid leaking them in local builds
  sourcemaps: {
    disable: !process.env.CI,
  },
  // Disable the Sentry webpack plugin in local builds — it adds substantial
  // overhead to the client bundle (~720KB gzip) for source-map processing
  // and telemetry that is only useful in CI/production deployments.
  disableClientWebpackPlugin: !process.env.CI,
  webpack: {
    autoInstrumentServerFunctions: false,
  },
}))
