import Link from "next/link"

export default function NotFound(): React.ReactElement {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center"
      style={{ background: "var(--theme-bg-primary, #1b1f31)" }}
    >
      <h1
        className="text-6xl font-bold"
        style={{ color: "var(--theme-accent, #00e5ff)" }}
      >
        404
      </h1>

      <div>
        <h2
          className="text-xl font-semibold"
          style={{ color: "var(--theme-text-primary, #e8ecf4)" }}
        >
          Page not found
        </h2>
        <p
          className="mt-2 max-w-xs text-sm"
          style={{ color: "var(--theme-text-secondary, #8f9bbf)" }}
        >
          The page you were looking for doesn't exist or has been moved.
        </p>
      </div>

      <Link
        href="/channels/me"
        className="px-4 py-2 rounded text-sm font-medium text-white transition-colors hover:opacity-90"
        style={{ background: "var(--theme-accent, #00e5ff)" }}
      >
        Back to VortexChat
      </Link>
    </div>
  )
}
