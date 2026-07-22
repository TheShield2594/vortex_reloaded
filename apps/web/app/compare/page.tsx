import Link from "next/link"
import type { Metadata } from "next"
import { CheckCircle2, X, Minus, ExternalLink } from "lucide-react"
import { VortexLogo } from "@/components/ui/vortex-logo"

export const metadata: Metadata = {
  title: "How VortexChat Compares — vs Discord, Revolt, Matrix, Rocket.Chat",
  description:
    "See how VortexChat stacks up against Discord, Revolt, Matrix/Element, Rocket.Chat, and more. Feature-by-feature comparison of community platforms.",
}

// ── Data ──────────────────────────────────────────────────────────────────────

type CellValue = "yes" | "no" | "partial" | string

interface Platform {
  name: string
  accent: string
  description: string
  link: string
}

interface ComparisonRow {
  feature: string
  tooltip?: string
  values: Record<string, CellValue>
}

const platforms: Platform[] = [
  { name: "VortexChat", accent: "#00e5ff", description: "Transparent, open-source community platform", link: "/" },
  { name: "Discord", accent: "#5865f2", description: "Largest community chat platform", link: "https://discord.com" },
  { name: "Revolt", accent: "#ff4654", description: "Open-source Discord alternative", link: "https://revolt.chat" },
  { name: "Matrix / Element", accent: "#0dbd8b", description: "Decentralized, privacy-focused protocol", link: "https://element.io" },
  { name: "Rocket.Chat", accent: "#f5455c", description: "Self-hosted enterprise messaging", link: "https://rocket.chat" },
]

const categories: { heading: string; rows: ComparisonRow[] }[] = [
  {
    heading: "Transparency & Moderation",
    rows: [
      {
        feature: "Full moderation audit trail",
        values: { VortexChat: "yes", Discord: "partial", Revolt: "partial", "Matrix / Element": "no", "Rocket.Chat": "partial" },
      },
      {
        feature: "Permission preview before apply",
        values: { VortexChat: "yes", Discord: "no", Revolt: "no", "Matrix / Element": "no", "Rocket.Chat": "no" },
      },
      {
        feature: "Right-click transparency view",
        values: { VortexChat: "yes", Discord: "no", Revolt: "no", "Matrix / Element": "no", "Rocket.Chat": "no" },
      },
      {
        feature: "Community health dashboard",
        values: { VortexChat: "yes", Discord: "Nitro-gated", Revolt: "no", "Matrix / Element": "no", "Rocket.Chat": "partial" },
      },
    ],
  },
  {
    heading: "Voice & Media",
    rows: [
      {
        feature: "Voice transcription & summaries",
        values: { VortexChat: "yes", Discord: "no", Revolt: "no", "Matrix / Element": "no", "Rocket.Chat": "Paid add-on" },
      },
      {
        feature: "Dual-mode voice (P2P + SFU)",
        values: { VortexChat: "yes", Discord: "no", Revolt: "no", "Matrix / Element": "partial", "Rocket.Chat": "no" },
      },
      {
        feature: "Screen share with system audio",
        values: { VortexChat: "yes", Discord: "yes", Revolt: "no", "Matrix / Element": "partial", "Rocket.Chat": "no" },
      },
    ],
  },
  {
    heading: "Privacy & Ownership",
    rows: [
      {
        feature: "Open source",
        values: { VortexChat: "yes", Discord: "no", Revolt: "yes", "Matrix / Element": "yes", "Rocket.Chat": "yes" },
      },
      {
        feature: "Self-hostable",
        values: { VortexChat: "yes", Discord: "no", Revolt: "yes", "Matrix / Element": "yes", "Rocket.Chat": "yes" },
      },
      {
        feature: "E2EE on DMs",
        values: { VortexChat: "Optional", Discord: "no", Revolt: "no", "Matrix / Element": "Default", "Rocket.Chat": "Optional" },
      },
      {
        feature: "GDPR data export (one-click)",
        values: { VortexChat: "yes", Discord: "Manual request", Revolt: "no", "Matrix / Element": "partial", "Rocket.Chat": "partial" },
      },
      {
        feature: "Offline message queue",
        values: { VortexChat: "yes", Discord: "no", Revolt: "no", "Matrix / Element": "partial", "Rocket.Chat": "no" },
      },
    ],
  },
  {
    heading: "Customization & Platform",
    rows: [
      {
        feature: "Theme system",
        values: { VortexChat: "11 themes + CSS", Discord: "Dark/Light", Revolt: "Basic", "Matrix / Element": "Basic", "Rocket.Chat": "Basic" },
      },
      {
        feature: "Built-in app marketplace",
        values: { VortexChat: "5 apps + marketplace", Discord: "Bot API only", Revolt: "Minimal", "Matrix / Element": "Widgets", "Rocket.Chat": "Marketplace" },
      },
      {
        feature: "Server templates (Blueprints)",
        values: { VortexChat: "JSON + diff preview", Discord: "Basic", Revolt: "no", "Matrix / Element": "no", "Rocket.Chat": "no" },
      },
      {
        feature: "Auto-expiring channels",
        values: { VortexChat: "yes", Discord: "no", Revolt: "no", "Matrix / Element": "no", "Rocket.Chat": "no" },
      },
    ],
  },
  {
    heading: "Pricing",
    rows: [
      {
        feature: "All features free",
        values: { VortexChat: "yes", Discord: "Nitro-gated", Revolt: "yes", "Matrix / Element": "Self-host only", "Rocket.Chat": "Paid tiers" },
      },
      {
        feature: "No upload size paywalls",
        values: { VortexChat: "yes", Discord: "no", Revolt: "yes", "Matrix / Element": "Depends on server", "Rocket.Chat": "yes" },
      },
    ],
  },
]

function CellIcon({ value }: { value: CellValue }): React.JSX.Element {
  if (value === "yes") {
    return <CheckCircle2 className="h-4 w-4" style={{ color: "#3ddc97" }} aria-label="Yes" />
  }
  if (value === "no") {
    return <X className="h-4 w-4" style={{ color: "var(--theme-text-muted)", opacity: 0.4 }} aria-label="No" />
  }
  if (value === "partial") {
    return <Minus className="h-4 w-4" style={{ color: "#ffb84d" }} aria-label="Partial" />
  }
  // Custom string value
  return (
    <span className="text-xs" style={{ color: "var(--theme-text-secondary)" }}>
      {value}
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ComparePage(): React.JSX.Element {
  return (
    <div
      className="min-h-[100dvh]"
      style={{ background: "var(--theme-bg-primary)", color: "var(--theme-text-primary)" }}
    >
      {/* ── Navbar ─────────────────────────────────────────────────────── */}
      <nav
        className="sticky top-0 z-sticky border-b backdrop-blur-md"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(27,31,49,0.85)" }}
        aria-label="Main navigation"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3 md:px-10">
          <Link href="/" className="flex items-center gap-2.5">
            <VortexLogo size={32} />
            <span className="text-base font-bold tracking-tight font-display" style={{ color: "var(--theme-text-bright)" }}>
              VortexChat
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--theme-accent)", color: "var(--theme-bg-tertiary)" }}
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <header className="mx-auto max-w-6xl px-6 py-16 md:px-10 lg:py-20">
        <Link
          href="/"
          className="mb-6 inline-block text-xs hover:underline"
          style={{ color: "var(--theme-accent)" }}
        >
          &larr; Back to VortexChat
        </Link>

        <h1
          className="text-3xl font-extrabold leading-[1.1] tracking-tight font-display md:text-5xl"
          style={{ color: "var(--theme-text-bright)" }}
        >
          How Vortex{" "}
          <span style={{ color: "var(--theme-accent)" }}>compares</span>
        </h1>

        <p
          className="mt-4 max-w-2xl text-lg leading-relaxed"
          style={{ color: "var(--theme-text-secondary)" }}
        >
          An honest, feature-by-feature look at where VortexChat stands against Discord
          and the open-source alternatives. No spin — just checkmarks.
        </p>
      </header>

      {/* ── Platform Legend ─────────────────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-secondary)" }}
      >
        <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
          <div className="flex flex-wrap gap-4">
            {platforms.map(({ name, accent, description }) => (
              <div
                key={name}
                className="flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm"
                style={{ borderColor: `${accent}33`, background: `${accent}0a` }}
              >
                <span
                  className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{ background: accent }}
                  aria-hidden="true"
                />
                <span style={{ color: "var(--theme-text-bright)" }} className="font-semibold">
                  {name}
                </span>
                <span className="hidden sm:inline text-xs" style={{ color: "var(--theme-text-muted)" }}>
                  — {description}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Comparison Tables ──────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-10 md:px-10">
        <div className="space-y-10">
          {categories.map(({ heading, rows }) => (
            <div key={heading}>
              <h2
                className="mb-4 text-lg font-bold font-display"
                style={{ color: "var(--theme-text-bright)" }}
              >
                {heading}
              </h2>
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                <table className="w-full text-sm" style={{ minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: "var(--theme-bg-tertiary)" }}>
                      <th
                        className="px-4 py-3 text-left font-semibold"
                        style={{ color: "var(--theme-text-muted)", width: "28%" }}
                      >
                        Feature
                      </th>
                      {platforms.map(({ name, accent }) => (
                        <th
                          key={name}
                          className="px-4 py-3 text-center font-semibold"
                          style={{ color: accent, width: `${72 / platforms.length}%` }}
                        >
                          {name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ feature, values }, i) => (
                      <tr
                        key={feature}
                        style={{
                          background: i % 2 === 0 ? "var(--theme-bg-secondary)" : "var(--theme-bg-primary)",
                          borderTop: "1px solid rgba(255,255,255,0.04)",
                        }}
                      >
                        <td className="px-4 py-3 font-medium" style={{ color: "var(--theme-text-primary)" }}>
                          {feature}
                        </td>
                        {platforms.map(({ name }) => (
                          <td key={name} className="px-4 py-3 text-center">
                            <span className="inline-flex items-center justify-center">
                              <CellIcon value={values[name] ?? "no"} />
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-xs leading-relaxed" style={{ color: "var(--theme-text-muted)" }}>
          Comparison data as of March 2026. We do our best to keep this accurate — if something
          has changed,{" "}
          <a
            href="https://github.com/TheShield2594/vortexchat/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:opacity-80"
            style={{ color: "var(--theme-accent)" }}
          >
            open an issue
            <ExternalLink className="ml-0.5 inline h-2.5 w-2.5" aria-hidden="true" />
          </a>{" "}
          and we&apos;ll update it.
        </p>
      </section>

      {/* ── Key Takeaways ──────────────────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-secondary)" }}
        aria-labelledby="takeaways-heading"
      >
        <div className="mx-auto max-w-6xl px-6 py-14 md:px-10">
          <h2
            id="takeaways-heading"
            className="mb-6 text-xl font-bold font-display"
            style={{ color: "var(--theme-text-bright)" }}
          >
            Where Vortex stands out
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: "vs Discord",
                body: "Open source, no paywalls, full mod audit trail, voice transcription, permission previews, self-hostable.",
                accent: "#5865f2",
              },
              {
                title: "vs Revolt",
                body: "Voice transcription, built-in app marketplace, permission sandbox, community health dashboard, 11 themes.",
                accent: "#ff4654",
              },
              {
                title: "vs Matrix / Element",
                body: "Mod Ledger, permission sandbox, built-in apps, voice with transcription, polished UX out of the box.",
                accent: "#0dbd8b",
              },
              {
                title: "vs Rocket.Chat",
                body: "All features free (no paid tiers), voice transcription, permission preview, auto-expiring channels, PWA-first.",
                accent: "#f5455c",
              },
            ].map(({ title, body, accent }) => (
              <div
                key={title}
                className="rounded-xl border p-5"
                style={{ borderColor: `${accent}30`, background: "var(--theme-bg-primary)" }}
              >
                <h3 className="mb-2 font-semibold font-display" style={{ color: accent }}>
                  {title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--theme-text-secondary)" }}>
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16 text-center md:px-10">
        <h2
          className="mb-3 text-2xl font-bold font-display md:text-3xl"
          style={{ color: "var(--theme-text-bright)" }}
        >
          Ready to switch?
        </h2>
        <p className="mb-8 text-sm max-w-md mx-auto" style={{ color: "var(--theme-text-secondary)" }}>
          Free forever. Every feature included. Start in 30 seconds or self-host on your own infrastructure.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-lg px-7 py-3 font-semibold transition-opacity hover:opacity-90"
            style={{ background: "var(--theme-accent)", color: "var(--theme-bg-tertiary)" }}
          >
            Start Your Community
          </Link>
          <Link
            href="/self-host"
            className="inline-flex items-center gap-2 rounded-lg border px-7 py-3 font-semibold transition-colors hover:opacity-80"
            style={{
              borderColor: "rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)",
              color: "var(--theme-text-primary)",
            }}
          >
            Deploy Your Own
          </Link>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-tertiary)" }}
        aria-label="Site footer"
      >
        <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
          <div
            className="flex flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between"
            style={{ color: "var(--theme-text-muted)" }}
          >
            <div className="flex items-center gap-2">
              <VortexLogo size={24} />
              <p>&copy; {new Date().getFullYear()} VortexChat. Open source, free forever.</p>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>Home</Link>
              <Link href="/self-host" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>Self-Host</Link>
              <Link href="/terms" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>Terms</Link>
              <Link href="/privacy" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>Privacy</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
