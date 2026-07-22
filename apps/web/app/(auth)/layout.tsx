export const dynamic = "force-dynamic"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main
      id="main-content"
      className="relative flex min-h-[100dvh] items-center justify-center overflow-x-hidden overflow-y-auto px-6 py-8"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% -10%, color-mix(in srgb, var(--theme-accent) 10%, transparent), transparent 70%), var(--theme-bg-tertiary)",
      }}
    >
      {/* Accent glow blob */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full blur-3xl vortex-glow"
        style={{ background: "var(--theme-accent)", opacity: 0.18 }}
      />
      <div className="relative w-full max-w-md">
        {children}
      </div>
    </main>
  )
}
