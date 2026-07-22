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
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.in',
      },
    ],
  },
  eslint: {
    // ESLint linting is run separately via `eslint .` — skip during `next build`
    // to avoid a workspace hoisting issue with minimatch versions
    ignoreDuringBuilds: true,
  },
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,
  transpilePackages: ['@vortex/shared'],
  webpack: (config, { isServer }) => {
    if (!isServer) {
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
          supabase: {
            test: /[\\/]node_modules[\\/]@supabase[\\/]/,
            name: "supabase",
            chunks: "all",
            priority: 25,
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
