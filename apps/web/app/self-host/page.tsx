import Link from "next/link"
import type { Metadata } from "next"
import {
  ArrowRight,
  Github,
  Server,
  Database,
  Radio,
  Terminal,
  Shield,
  ExternalLink,
  CheckCircle2,
} from "lucide-react"
import { VortexLogo } from "@/components/ui/vortex-logo"

export const metadata: Metadata = {
  title: "Self-Host VortexChat — Deploy Your Own Instance",
  description:
    "Deploy VortexChat on your own infrastructure. Three services, full control, open-source. Docker, Railway, and Vercel deployment guides.",
}

// ── Data ──────────────────────────────────────────────────────────────────────

const stackComponents = [
  {
    icon: Server,
    name: "Next.js Web App",
    description:
      "The frontend and API layer. Handles authentication, real-time chat, permissions, and the built-in app platform.",
    tech: "Next.js 16, TypeScript, React",
    accent: "#00e5ff",
  },
  {
    icon: Database,
    name: "Supabase",
    description:
      "Postgres database, auth, file storage, and real-time subscriptions via CDC. No polling — changes push instantly.",
    tech: "PostgreSQL, Row-Level Security, Realtime",
    accent: "#3ddc97",
  },
  {
    icon: Radio,
    name: "Signal Server",
    description:
      "Lightweight Socket.IO server for WebRTC signaling. Handles voice channel coordination and peer connection negotiation.",
    tech: "Node.js, Socket.IO, WebRTC",
    accent: "#f92aad",
  },
]

const deployOptions = [
  {
    name: "Docker Compose",
    description: "Single command, runs all three services locally or on any VPS. Best for full control.",
    command: "git clone https://github.com/TheShield2594/vortexchat && cd vortexchat && docker compose up",
    accent: "#00e5ff",
  },
  {
    name: "Railway",
    description: "One-click cloud deploy. Railway provisions Postgres, the web app, and the signal server automatically.",
    command: "railway up",
    accent: "#a855f7",
  },
  {
    name: "Vercel + Supabase",
    description: "Deploy the web app to Vercel's edge network. Use Supabase Cloud for the database and run the signal server separately.",
    command: "vercel deploy",
    accent: "#ffb84d",
  },
]

const benefits = [
  "Your data stays on your servers — no third-party access",
  "Customize everything — themes, branding, default settings",
  "No usage limits, no seat caps, no surprise bills",
  "Full audit trail you control and can query directly",
  "Air-gapped deployments for sensitive environments",
  "Automatic updates via git pull or container image tags",
]

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SelfHostPage(): React.JSX.Element {
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
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3 md:px-10">
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
      <header className="mx-auto max-w-5xl px-6 py-16 md:px-10 lg:py-24">
        <Link
          href="/"
          className="mb-6 inline-block text-xs hover:underline"
          style={{ color: "var(--theme-accent)" }}
        >
          &larr; Back to VortexChat
        </Link>

        <div
          className="mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-widest"
          style={{
            borderColor: "color-mix(in srgb, var(--theme-accent) 25%, transparent)",
            background: "color-mix(in srgb, var(--theme-accent) 8%, transparent)",
            color: "var(--theme-accent)",
          }}
        >
          Open source · Self-hostable · Your infrastructure
        </div>

        <h1
          className="text-3xl font-extrabold leading-[1.1] tracking-tight font-display md:text-5xl"
          style={{ color: "var(--theme-text-bright)" }}
        >
          Your community.{" "}
          <span style={{ color: "var(--theme-accent)" }}>Your servers.</span>
        </h1>

        <p
          className="mt-5 max-w-2xl text-lg leading-relaxed"
          style={{ color: "var(--theme-text-secondary)" }}
        >
          VortexChat is three services, not a monolith. Deploy them anywhere —
          a $5 VPS, your corporate network, or a managed cloud. Same features,
          full control, zero vendor lock-in.
        </p>
      </header>

      {/* ── Architecture ───────────────────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-secondary)" }}
        aria-labelledby="architecture-heading"
      >
        <div className="mx-auto max-w-5xl px-6 py-14 md:px-10">
          <div className="mb-10">
            <p
              className="mb-2 text-xs font-semibold uppercase tracking-widest font-display"
              style={{ color: "var(--theme-accent)" }}
            >
              Three services, that&apos;s it
            </p>
            <h2
              id="architecture-heading"
              className="text-2xl font-bold font-display"
              style={{ color: "var(--theme-text-bright)" }}
            >
              What you&apos;re deploying
            </h2>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {stackComponents.map(({ icon: Icon, name, description, tech, accent }) => (
              <div
                key={name}
                className="rounded-xl border p-6"
                style={{
                  borderColor: hexToRgba(accent, 0.18),
                  background: "var(--theme-bg-primary)",
                }}
              >
                <div
                  className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ background: hexToRgba(accent, 0.12) }}
                >
                  <Icon aria-hidden="true" className="h-5 w-5" style={{ color: accent }} />
                </div>
                <h3 className="mb-1.5 font-semibold font-display" style={{ color: "var(--theme-text-bright)" }}>
                  {name}
                </h3>
                <p className="mb-3 text-sm leading-relaxed" style={{ color: "var(--theme-text-secondary)" }}>
                  {description}
                </p>
                <p
                  className="text-xs font-mono"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  {tech}
                </p>
              </div>
            ))}
          </div>

          {/* Simplified architecture diagram */}
          <div
            className="mt-8 rounded-xl border p-6 text-center font-mono text-sm"
            style={{
              borderColor: "rgba(255,255,255,0.08)",
              background: "var(--theme-bg-primary)",
              color: "var(--theme-text-muted)",
            }}
          >
            <p style={{ color: "var(--theme-text-bright)" }} className="mb-3 font-display font-semibold text-xs uppercase tracking-widest">
              Request Flow
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
              <span className="rounded border px-3 py-1.5" style={{ borderColor: "rgba(255,255,255,0.12)", color: "#00e5ff" }}>
                Browser (PWA)
              </span>
              <span style={{ color: "var(--theme-text-muted)" }}>&rarr;</span>
              <span className="rounded border px-3 py-1.5" style={{ borderColor: "rgba(255,255,255,0.12)", color: "#00e5ff" }}>
                Next.js App
              </span>
              <span style={{ color: "var(--theme-text-muted)" }}>&rarr;</span>
              <span className="rounded border px-3 py-1.5" style={{ borderColor: "rgba(255,255,255,0.12)", color: "#3ddc97" }}>
                Supabase (Postgres + Auth + Realtime)
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
              <span className="rounded border px-3 py-1.5" style={{ borderColor: "rgba(255,255,255,0.12)", color: "#00e5ff" }}>
                Browser (PWA)
              </span>
              <span style={{ color: "var(--theme-text-muted)" }}>&rarr;</span>
              <span className="rounded border px-3 py-1.5" style={{ borderColor: "rgba(255,255,255,0.12)", color: "#f92aad" }}>
                Signal Server (Socket.IO)
              </span>
              <span style={{ color: "var(--theme-text-muted)" }}>&rarr;</span>
              <span className="rounded border px-3 py-1.5" style={{ borderColor: "rgba(255,255,255,0.12)", color: "#f92aad" }}>
                WebRTC Peer-to-Peer
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Deploy Options ─────────────────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
        aria-labelledby="deploy-heading"
      >
        <div className="mx-auto max-w-5xl px-6 py-14 md:px-10">
          <div className="mb-10">
            <p
              className="mb-2 text-xs font-semibold uppercase tracking-widest font-display"
              style={{ color: "var(--theme-accent)" }}
            >
              Pick your path
            </p>
            <h2
              id="deploy-heading"
              className="text-2xl font-bold font-display"
              style={{ color: "var(--theme-text-bright)" }}
            >
              Deploy in minutes
            </h2>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {deployOptions.map(({ name, description, command, accent }) => (
              <div
                key={name}
                className="rounded-xl border p-6"
                style={{
                  borderColor: hexToRgba(accent, 0.18),
                  background: "var(--theme-bg-secondary)",
                }}
              >
                <h3 className="mb-2 font-semibold font-display" style={{ color: "var(--theme-text-bright)" }}>
                  {name}
                </h3>
                <p className="mb-4 text-sm leading-relaxed" style={{ color: "var(--theme-text-secondary)" }}>
                  {description}
                </p>
                <code
                  className="block rounded-lg px-4 py-3 text-xs overflow-x-auto"
                  style={{
                    background: "var(--theme-bg-primary)",
                    color: accent,
                    border: `1px solid ${hexToRgba(accent, 0.12)}`,
                  }}
                >
                  {command}
                </code>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Estimated Costs ────────────────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-secondary)" }}
        aria-labelledby="costs-heading"
      >
        <div className="mx-auto max-w-5xl px-6 py-14 md:px-10">
          <div className="mb-10">
            <p
              className="mb-2 text-xs font-semibold uppercase tracking-widest font-display"
              style={{ color: "var(--theme-accent)" }}
            >
              No surprises
            </p>
            <h2
              id="costs-heading"
              className="text-2xl font-bold font-display"
              style={{ color: "var(--theme-text-bright)" }}
            >
              Estimated hosting costs
            </h2>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {[
              {
                tier: "Hobby",
                price: "$0/mo",
                note: "Free tiers",
                items: ["Vercel Hobby (free)", "Supabase Free (500 MB, 50K MAU)", "Signal server on Railway free tier"],
                accent: "#3ddc97",
              },
              {
                tier: "Community",
                price: "~$25/mo",
                note: "Small to mid servers",
                items: ["Vercel Pro ($20/mo)", "Supabase Pro ($25/mo, 8 GB)", "Signal server on shared VPS ($5/mo)"],
                accent: "#00e5ff",
              },
              {
                tier: "Self-Managed",
                price: "~$10/mo",
                note: "Full control",
                items: ["Single VPS ($5–10/mo)", "Self-hosted Supabase via Docker", "All services on one machine"],
                accent: "#ffb84d",
              },
            ].map(({ tier, price, note, items, accent }) => (
              <div
                key={tier}
                className="rounded-xl border p-6"
                style={{
                  borderColor: hexToRgba(accent, 0.18),
                  background: "var(--theme-bg-primary)",
                }}
              >
                <p className="text-2xl font-extrabold font-display" style={{ color: accent }}>
                  {price}
                </p>
                <h3 className="mt-1 font-semibold font-display" style={{ color: "var(--theme-text-bright)" }}>
                  {tier}
                </h3>
                <p className="mb-4 text-xs" style={{ color: "var(--theme-text-muted)" }}>
                  {note}
                </p>
                <ul className="space-y-2">
                  {items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" style={{ color: accent }} aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why Self-Host ──────────────────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
        aria-labelledby="why-heading"
      >
        <div className="mx-auto max-w-5xl px-6 py-14 md:px-10">
          <div className="mb-10">
            <p
              className="mb-2 text-xs font-semibold uppercase tracking-widest font-display"
              style={{ color: "var(--theme-accent)" }}
            >
              Your infrastructure, your rules
            </p>
            <h2
              id="why-heading"
              className="text-2xl font-bold font-display"
              style={{ color: "var(--theme-text-bright)" }}
            >
              Why self-host?
            </h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {benefits.map((benefit) => (
              <div
                key={benefit}
                className="flex items-start gap-3 rounded-lg border p-4"
                style={{
                  borderColor: "rgba(255,255,255,0.06)",
                  background: "var(--theme-bg-secondary)",
                }}
              >
                <Shield className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: "var(--theme-accent)" }} aria-hidden="true" />
                <p className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>
                  {benefit}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-secondary)" }}
        aria-labelledby="self-host-cta-heading"
      >
        <div className="mx-auto max-w-5xl px-6 py-16 text-center md:px-10">
          <div
            className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full mb-5"
            style={{ background: "color-mix(in srgb, var(--theme-accent) 12%, transparent)" }}
            aria-hidden="true"
          >
            <Terminal className="h-6 w-6" style={{ color: "var(--theme-accent)" }} />
          </div>
          <h2
            id="self-host-cta-heading"
            className="mb-3 text-2xl font-bold font-display md:text-3xl"
            style={{ color: "var(--theme-text-bright)" }}
          >
            Ready to deploy?
          </h2>
          <p className="mb-8 text-sm max-w-md mx-auto" style={{ color: "var(--theme-text-secondary)" }}>
            Clone the repo, set your environment variables, and you&apos;re live.
            Full setup instructions in the README.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://github.com/TheShield2594/vortexchat"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg px-7 py-3 font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--theme-accent)", color: "var(--theme-bg-tertiary)" }}
            >
              <Github className="h-4 w-4" aria-hidden="true" />
              View on GitHub
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-lg border px-7 py-3 font-semibold transition-colors hover:opacity-80"
              style={{
                borderColor: "rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.05)",
                color: "var(--theme-text-primary)",
              }}
            >
              Or try the hosted version
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-tertiary)" }}
        aria-label="Site footer"
      >
        <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
          <div
            className="flex flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between"
            style={{ color: "var(--theme-text-muted)" }}
          >
            <div className="flex items-center gap-2">
              <VortexLogo size={24} />
              <p>&copy; {new Date().getFullYear()} VortexChat. Open source, free forever.</p>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>
                Home
              </Link>
              <Link href="/terms" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>
                Terms
              </Link>
              <Link href="/privacy" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>
                Privacy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
