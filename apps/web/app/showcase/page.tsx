import Link from "next/link"
import type { Metadata } from "next"
import { ArrowRight, MessageSquare, Users, ExternalLink } from "lucide-react"
import { VortexLogo } from "@/components/ui/vortex-logo"

export const metadata: Metadata = {
  title: "Community Showcase — Built with VortexChat",
  description:
    "See how real communities use VortexChat. From open-source projects to gaming guilds — discover what's possible on a transparent platform.",
}

// ── Data ──────────────────────────────────────────────────────────────────────

interface Testimonial {
  quote: string
  author: string
  role: string
  community: string
  accent: string
}

const testimonials: Testimonial[] = [
  {
    quote: "We moved our 12k-member server from Discord after our third unexplained shadow ban. Vortex's Mod Ledger means we can actually see what's happening. Moderation went from guesswork to accountability overnight.",
    author: "Jordan M.",
    role: "Community Lead",
    community: "Open-source gaming collective",
    accent: "#f92aad",
  },
  {
    quote: "The Permission Sandbox alone was worth the switch. We tested a full role restructure on our 8k server without breaking a single channel. On Discord, that would have been a 'cross your fingers and hope' moment.",
    author: "Priya K.",
    role: "Server Admin",
    community: "Developer community",
    accent: "#00e5ff",
  },
  {
    quote: "Our team runs async across 4 time zones. Vortex Recap transcribes our voice standup and posts a summary in the channel. Nobody has to wake up at 3am to be 'in the loop' anymore.",
    author: "Alex T.",
    role: "Engineering Manager",
    community: "Remote startup team",
    accent: "#3ddc97",
  },
  {
    quote: "We self-host VortexChat on a $10/mo VPS for our privacy-focused research group. E2EE on DMs, GDPR export, and full control of our data. No third party sees anything.",
    author: "Dr. Lena W.",
    role: "Research Lead",
    community: "University research lab",
    accent: "#ffb84d",
  },
]

const stats = [
  { value: "100%", label: "Open Source", sublabel: "Every line auditable" },
  { value: "5", label: "Built-in Apps", sublabel: "No bot hunting required" },
  { value: "11", label: "Themes", sublabel: "Express your identity" },
  { value: "$0", label: "For Every Feature", sublabel: "No paywalls, ever" },
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

export default function ShowcasePage(): React.JSX.Element {
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
      <header className="mx-auto max-w-5xl px-6 py-16 md:px-10 lg:py-20">
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
          Built with{" "}
          <span style={{ color: "var(--theme-accent)" }}>Vortex</span>
        </h1>

        <p
          className="mt-4 max-w-2xl text-lg leading-relaxed"
          style={{ color: "var(--theme-text-secondary)" }}
        >
          Real communities, real stories. See how teams and groups use VortexChat&apos;s
          transparency tools, voice recaps, and self-hosting to run communities
          that work.
        </p>
      </header>

      {/* ── Testimonials ───────────────────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-secondary)" }}
        aria-labelledby="stories-heading"
      >
        <div className="mx-auto max-w-5xl px-6 py-14 md:px-10">
          <h2
            id="stories-heading"
            className="mb-8 text-xl font-bold font-display"
            style={{ color: "var(--theme-text-bright)" }}
          >
            What communities are saying
          </h2>

          <div className="grid gap-5 md:grid-cols-2">
            {testimonials.map(({ quote, author, role, community, accent }) => (
              <div
                key={author}
                className="rounded-xl border p-6"
                style={{ borderColor: hexToRgba(accent, 0.18), background: "var(--theme-bg-primary)" }}
              >
                <MessageSquare
                  className="mb-3 h-5 w-5"
                  style={{ color: accent }}
                  aria-hidden="true"
                />
                <blockquote className="mb-4 text-sm leading-relaxed" style={{ color: "var(--theme-text-primary)" }}>
                  &ldquo;{quote}&rdquo;
                </blockquote>
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold"
                    style={{ background: hexToRgba(accent, 0.15), color: accent }}
                  >
                    {author.split(" ").map((n) => n[0] ?? "").join("").slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--theme-text-bright)" }}>
                      {author}
                    </p>
                    <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                      {role} · {community}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
        aria-labelledby="stats-heading"
      >
        <div className="mx-auto max-w-5xl px-6 py-14 md:px-10">
          <h2 id="stats-heading" className="sr-only">Platform stats</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 text-center">
            {stats.map(({ value, label, sublabel }) => (
              <div key={label}>
                <p
                  className="text-3xl font-extrabold font-display"
                  style={{ color: "var(--theme-accent)" }}
                >
                  {value}
                </p>
                <p className="mt-1 text-sm font-semibold" style={{ color: "var(--theme-text-bright)" }}>
                  {label}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--theme-text-muted)" }}>
                  {sublabel}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature Your Community CTA ─────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-secondary)" }}
      >
        <div className="mx-auto max-w-5xl px-6 py-14 md:px-10">
          <div className="rounded-xl border p-8 text-center" style={{ borderColor: "rgba(255,255,255,0.08)", background: "var(--theme-bg-primary)" }}>
            <Users className="mx-auto mb-4 h-8 w-8" style={{ color: "var(--theme-accent)" }} aria-hidden="true" />
            <h2
              className="mb-2 text-xl font-bold font-display"
              style={{ color: "var(--theme-text-bright)" }}
            >
              Want your community featured here?
            </h2>
            <p className="mb-6 text-sm max-w-md mx-auto" style={{ color: "var(--theme-text-secondary)" }}>
              If your community runs on VortexChat and you&apos;d like to share your story,
              we&apos;d love to hear from you. Open an issue or reach out on GitHub.
            </p>
            <a
              href="https://github.com/TheShield2594/vortexchat/issues/new?title=Showcase%20submission&labels=showcase"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg px-7 py-3 font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--theme-accent)", color: "var(--theme-bg-tertiary)" }}
            >
              Submit Your Community
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 py-16 text-center md:px-10">
        <h2
          className="mb-3 text-2xl font-bold font-display md:text-3xl"
          style={{ color: "var(--theme-text-bright)" }}
        >
          Start your community today.
        </h2>
        <p className="mb-8 text-sm max-w-md mx-auto" style={{ color: "var(--theme-text-secondary)" }}>
          Free forever. No credit card. Every feature included.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-lg px-7 py-3 font-semibold transition-opacity hover:opacity-90"
            style={{ background: "var(--theme-accent)", color: "var(--theme-bg-tertiary)" }}
          >
            Get Started <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href="/compare"
            className="inline-flex items-center gap-2 rounded-lg border px-7 py-3 font-semibold transition-colors hover:opacity-80"
            style={{
              borderColor: "rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)",
              color: "var(--theme-text-primary)",
            }}
          >
            See How We Compare
          </Link>
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
              <Link href="/" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>Home</Link>
              <Link href="/roadmap" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>Roadmap</Link>
              <Link href="/compare" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>Compare</Link>
              <Link href="/self-host" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>Self-Host</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
