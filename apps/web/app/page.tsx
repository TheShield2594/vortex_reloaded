import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import {
  ArrowRight,
  ShieldCheck,
  ClipboardList,
  Lock,
  Gift,
  CheckCircle2,
  Github,
  ExternalLink,
  Heart,
  Bot,
  PartyPopper,
  ClipboardCheck,
  Siren,
  Bell,
  Slash,
  Server,
  Database,
  Radio,
} from "lucide-react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { VortexLogo } from "@/components/ui/vortex-logo"
import { ScrollReveal } from "@/components/ui/scroll-reveal"
import { ChatMockup } from "@/components/ui/chat-mockup"

// ── SEO / OpenGraph ───────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "VortexChat — The Transparent Community Platform | Open Source Chat",
  description:
    "VortexChat is the chat platform with nothing to hide. Every moderation action logged, every permission testable, every line of code open. Free forever, open-source, and self-hostable.",
  openGraph: {
    title: "VortexChat — The Transparent Community Platform",
    description:
      "The chat platform with nothing to hide. Full audit trails, testable permissions, open-source code. Free forever.",
    type: "website",
    siteName: "VortexChat",
  },
  twitter: {
    card: "summary_large_image",
    title: "VortexChat — The Transparent Community Platform",
    description:
      "The chat platform with nothing to hide. Full audit trails, testable permissions, open-source code. Free forever.",
  },
  alternates: {
    canonical: "/",
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ── Data ──────────────────────────────────────────────────────────────────────

const useCases = [
  {
    icon: ClipboardList,
    label: "For moderation teams tired of guessing",
    description: "50,000 members and no idea which mod did what? Vortex\u2019s Mod Ledger logs every action so nothing happens in the dark.",
    accent: "#f92aad",
  },
  {
    icon: Gift,
    label: "For communities that got paywalled",
    description: "Custom emoji, bigger uploads, and quality screen share shouldn\u2019t cost extra. On Vortex, those are just\u2026 features.",
    accent: "#00e5ff",
  },
  {
    icon: Lock,
    label: "For privacy-conscious communities",
    description: "Your members need encrypted DMs and zero tracking. Vortex ships E2EE, GDPR export, and no ad-tech. Period.",
    accent: "#3ddc97",
  },
  {
    icon: ShieldCheck,
    label: "For projects that practice what they preach",
    description: "You build in the open. Your community platform should too. Fully open-source and self-hostable from day one.",
    accent: "#ffb84d",
  },
]

const themes = [
  { name: "Midnight Neon", accent: "#00e5ff", bg: "#1b1f31", label: "Default" },
  { name: "Synthwave", accent: "#f92aad", bg: "#2a1e46", label: "" },
  { name: "Carbon", accent: "#3ba55c", bg: "#1f2124", label: "" },
  { name: "Twilight", accent: "#5865f2", bg: "#313338", label: "" },
  { name: "Frost", accent: "#e0a526", bg: "#1a2332", label: "" },
  { name: "OLED Black", accent: "#0abab5", bg: "#000000", label: "" },
  { name: "Clarity", accent: "#2563eb", bg: "#f8fafc", label: "Light" },
  { name: "Velvet Dusk", accent: "#cba6f7", bg: "#1e1e2e", label: "" },
  { name: "Terminal", accent: "#4aef98", bg: "#000900", label: "" },
  { name: "Sakura Blossom", accent: "#e84393", bg: "#1a1218", label: "" },
  { name: "Frosthearth", accent: "#6eafc8", bg: "#1a1e24", label: "" },
]

const steps = [
  { num: "01", title: "See everything that happens", body: "Every ban, kick, role change, and message deletion is logged in a timeline you can audit. No shadow moderation." },
  { num: "02", title: "Test before you break", body: "The Permission Sandbox lets you preview exactly what any role can see and do\u200a—\u200abefore you apply changes to real users." },
  { num: "03", title: "Your voice, transcribed", body: "AI-powered transcripts and summaries for voice channels. Never miss what was said, even if you joined late." },
  { num: "04", title: "Take it with you", body: "Export your data. Self-host the platform. Fork the code. Your community is never locked in." },
]

const builtInApps = [
  {
    icon: Bot,
    name: "Welcome Bot",
    description: "Custom greetings, server rules, auto-role assignment, and optional DMs for every new member.",
    accent: "#3ddc97",
  },
  {
    icon: PartyPopper,
    name: "Giveaway Bot",
    description: "Timed giveaways with automatic winner selection, rerolls, and entry tracking.",
    accent: "#f92aad",
  },
  {
    icon: ClipboardCheck,
    name: "Standup Assistant",
    description: "Async daily standups with custom questions, scheduled reminders, and team response views.",
    accent: "#00e5ff",
  },
  {
    icon: Siren,
    name: "Incident Bot",
    description: "Track outages with severity levels, status workflows, timeline updates, and resolution logs.",
    accent: "#ff6b6b",
  },
  {
    icon: Bell,
    name: "Reminder Bot",
    description: "Personal reminders up to 24 hours out. Set it, forget it, get notified on time.",
    accent: "#ffb84d",
  },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function HomePage() {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (!error && user) {
      redirect("/channels/me")
    }
  } catch (err: unknown) {
    // redirect() throws a Next.js internal error with a NEXT_REDIRECT digest — rethrow it
    const digest = (err as { digest?: string })?.digest
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      throw err
    }
    // Auth check failed — fall through to render the landing page
    console.error("[HomePage] Auth check failed:", err instanceof Error ? err.message : "unknown error")
  }

  return (
    <main id="main-content" className="min-h-screen" style={{ background: "var(--theme-bg-primary)", color: "var(--theme-text-primary)" }}>

      {/* ── Navbar ───────────────────────────────────────────────────────── */}
      <nav
        className="sticky top-0 z-sticky border-b backdrop-blur-md"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(27,31,49,0.85)" }}
        aria-label="Main navigation"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3 md:px-10">
          <div className="flex items-center gap-2.5">
            <VortexLogo size={32} />
            <span className="text-base font-bold tracking-tight font-display" style={{ color: "var(--theme-text-bright)" }}>
              VortexChat
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-md px-4 py-1.5 text-sm font-medium transition-opacity hover:opacity-80"
              style={{ color: "var(--theme-text-secondary)" }}
            >
              Sign In
            </Link>
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

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden border-b"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
        aria-labelledby="hero-heading"
      >
        {/* Gradient mesh background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% -10%, color-mix(in srgb, var(--theme-accent) 14%, transparent), transparent 65%), radial-gradient(ellipse 50% 40% at 85% 70%, color-mix(in srgb, var(--theme-accent-secondary) 8%, transparent), transparent 60%), var(--theme-bg-primary)",
          }}
        />

        <div className="relative mx-auto max-w-6xl px-6 py-20 md:px-10 lg:flex lg:items-center lg:gap-16 lg:py-32">
          {/* Left — copy */}
          <div className="flex-1 max-w-2xl">
            <div
              className="mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-widest"
              style={{
                borderColor: "color-mix(in srgb, var(--theme-accent) 25%, transparent)",
                background: "color-mix(in srgb, var(--theme-accent) 8%, transparent)",
                color: "var(--theme-accent)",
              }}
            >
              Open source · Fully auditable · No dark patterns
            </div>

            <h1
              id="hero-heading"
              className="text-4xl font-extrabold leading-[1.1] tracking-tight font-display md:text-6xl"
              style={{ color: "var(--theme-text-bright)" }}
            >
              The chat platform with{" "}
              <span style={{ color: "var(--theme-accent)" }}>nothing to hide</span>
            </h1>

            <p
              className="mt-5 text-lg md:text-xl leading-relaxed"
              style={{ color: "var(--theme-text-secondary)" }}
            >
              Every moderation action logged. Every permission testable.
              Every line of code open. VortexChat is the community platform
              that trusts you as much as you trust it.
            </p>

            <ul className="mt-5 space-y-2 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
              {[
                "Full audit trail on every moderation action",
                "Test permissions before applying them to real users",
                "Open-source, self-hostable, and free forever",
              ].map((point) => (
                <li key={point} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: "var(--theme-success)" }} aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold transition-opacity hover:opacity-90"
                style={{ background: "var(--theme-accent)", color: "var(--theme-bg-tertiary)" }}
              >
                Start Your Community <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
              <a
                href="https://github.com/TheShield2594/vortexchat"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border px-6 py-3 font-semibold transition-colors hover:opacity-80"
                style={{
                  borderColor: "rgba(255,255,255,0.15)",
                  background: "rgba(255,255,255,0.05)",
                  color: "var(--theme-text-primary)",
                }}
              >
                <Github className="h-4 w-4" aria-hidden="true" />
                View the Source
              </a>
            </div>
          </div>

          {/* Right — chat UI preview */}
          <div className="mt-14 lg:mt-0 flex-shrink-0 relative">
            {/* Glow behind mockup */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none vortex-glow"
              style={{ background: "var(--theme-accent)", filter: "blur(80px)", opacity: 0.12 }}
              aria-hidden="true"
            />
            <ChatMockup />
          </div>
        </div>
      </section>

      {/* ── What Makes Vortex Different ─────────────────────────────────── */}
      <section
        className="border-t border-b"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-secondary)" }}
        aria-labelledby="how-it-works-heading"
      >
        <div className="mx-auto max-w-6xl px-6 py-16 md:px-10">
          <div className="mb-10 text-center">
            <p
              className="mb-2 text-xs font-semibold uppercase tracking-widest font-display"
              style={{ color: "var(--theme-accent)" }}
            >
              Not just another chat app
            </p>
            <h2
              id="how-it-works-heading"
              className="text-2xl font-bold font-display"
              style={{ color: "var(--theme-text-bright)" }}
            >
              What makes Vortex different
            </h2>
          </div>

          <div className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {/* Connector line — spans between step circles */}
            <div
              className="absolute hidden lg:block top-5 left-[12.5%] right-[12.5%] h-px"
              style={{ background: "rgba(255,255,255,0.08)" }}
              aria-hidden="true"
            />
            {steps.map((step, i) => (
              <ScrollReveal key={step.num} delay={i * 120}>
                <div className="relative flex flex-col items-center text-center">
                  <div
                    className="relative z-10 mb-4 flex h-10 w-10 items-center justify-center rounded-full border text-sm font-bold font-display"
                    style={{
                      borderColor: "color-mix(in srgb, var(--theme-accent) 30%, transparent)",
                      background: "color-mix(in srgb, var(--theme-accent) 10%, var(--theme-bg-secondary))",
                      color: "var(--theme-accent)",
                    }}
                  >
                    {step.num}
                  </div>
                  <h3
                    className="mb-2 font-semibold font-display"
                    style={{ color: "var(--theme-text-bright)" }}
                  >
                    {step.title}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--theme-text-secondary)" }}>
                    {step.body}
                  </p>
                </div>
              </ScrollReveal>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--theme-accent)", color: "var(--theme-bg-tertiary)" }}
            >
              Start Your Community <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Themes ────────────────────────────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-secondary)" }}
        aria-labelledby="themes-heading"
      >
        <div className="mx-auto max-w-6xl px-6 py-14 md:px-10">
          <ScrollReveal>
            <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
              <div className="max-w-sm">
                <p
                  className="mb-2 text-xs font-semibold uppercase tracking-widest font-display"
                  style={{ color: "var(--theme-accent)" }}
                >
                  Make it yours
                </p>
                <h2
                  id="themes-heading"
                  className="mb-2 text-2xl font-bold font-display"
                  style={{ color: "var(--theme-text-bright)" }}
                >
                  Your interface, your vibe.
                </h2>
                <p className="text-sm leading-relaxed" style={{ color: "var(--theme-text-secondary)" }}>
                  Endless customization options — hand-crafted themes, custom accent colors, and full CSS
                  overrides ship with every account. Switch instantly, no refresh required. All free.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                {themes.map((theme) => {
                  const isLight = theme.label === "Light"
                  return (
                  <div
                    key={theme.name}
                    className="flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-medium"
                    style={{
                      background: theme.bg,
                      borderColor: hexToRgba(theme.accent, 0.25),
                      color: isLight ? "#1e293b" : "#e6ecff",
                    }}
                  >
                    <span
                      className="inline-block h-3 w-3 flex-shrink-0 rounded-full"
                      style={{ background: theme.accent, boxShadow: `0 0 6px ${hexToRgba(theme.accent, 0.5)}` }}
                      aria-hidden="true"
                    />
                    <span>{theme.name}</span>
                    {theme.label && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        style={{
                          background: hexToRgba(theme.accent, 0.13),
                          color: theme.accent,
                          border: `1px solid ${hexToRgba(theme.accent, 0.27)}`,
                        }}
                      >
                        {theme.label}
                      </span>
                    )}
                  </div>
                  )
                })}
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Use Cases ────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16 md:px-10" aria-labelledby="use-cases-heading">
        <ScrollReveal>
          <div className="mb-10">
            <p
              className="mb-2 text-xs font-semibold uppercase tracking-widest font-display"
              style={{ color: "var(--theme-accent)" }}
            >
              Why people switch
            </p>
            <h2
              id="use-cases-heading"
              className="text-2xl font-bold font-display"
              style={{ color: "var(--theme-text-bright)" }}
            >
              Built for communities that outgrew Discord.
            </h2>
          </div>
        </ScrollReveal>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {useCases.map(({ icon: Icon, label, description, accent }, i) => (
            <ScrollReveal key={label} delay={i * 80}>
              <div
                className="h-full rounded-xl border p-5"
                style={{
                  borderColor: hexToRgba(accent, 0.18),
                  background: "var(--theme-bg-secondary)",
                }}
              >
                <div
                  className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ background: hexToRgba(accent, 0.12) }}
                >
                  <Icon aria-hidden="true" className="h-5 w-5" style={{ color: accent }} />
                </div>
                <h3 className="mb-1.5 font-semibold font-display" style={{ color: "var(--theme-text-bright)" }}>
                  {label}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--theme-text-secondary)" }}>
                  {description}
                </p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ── Built-in Apps ─────────────────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-secondary)" }}
        aria-labelledby="apps-heading"
      >
        <div className="mx-auto max-w-6xl px-6 py-16 md:px-10">
          <ScrollReveal>
            <div className="mb-10 text-center">
              <p
                className="mb-2 text-xs font-semibold uppercase tracking-widest font-display"
                style={{ color: "var(--theme-accent)" }}
              >
                No bot setup required
              </p>
              <h2
                id="apps-heading"
                className="text-2xl font-bold font-display"
                style={{ color: "var(--theme-text-bright)" }}
              >
                Essential tools, built right in.
              </h2>
              <p className="mt-3 mx-auto max-w-lg text-sm leading-relaxed" style={{ color: "var(--theme-text-secondary)" }}>
                Every VortexChat server ships with 5 verified apps — no hunting for third-party bots
                that might go offline. Install with one click, configure in settings.
              </p>
            </div>
          </ScrollReveal>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {builtInApps.map(({ icon: Icon, name, description, accent }, i) => (
              <ScrollReveal key={name} delay={i * 80}>
                <div
                  className="h-full rounded-xl border p-5 text-center"
                  style={{
                    borderColor: hexToRgba(accent, 0.18),
                    background: "var(--theme-bg-primary)",
                  }}
                >
                  <div
                    className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{ background: hexToRgba(accent, 0.12) }}
                  >
                    <Icon aria-hidden="true" className="h-5 w-5" style={{ color: accent }} />
                  </div>
                  <h3 className="mb-1.5 font-semibold text-sm font-display" style={{ color: "var(--theme-text-bright)" }}>
                    {name}
                  </h3>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--theme-text-secondary)" }}>
                    {description}
                  </p>
                </div>
              </ScrollReveal>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--theme-text-muted)" }}>
              <Slash aria-hidden="true" className="h-4 w-4" style={{ color: "var(--theme-accent)" }} />
              <span>Slash command autocomplete for every app</span>
            </div>
            <span className="hidden sm:inline" style={{ color: "rgba(255,255,255,0.15)" }}>|</span>
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--theme-text-muted)" }}>
              <ShieldCheck aria-hidden="true" className="h-4 w-4" style={{ color: "var(--theme-accent)" }} />
              <span>All verified &amp; permission-scoped</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Social Proof ──────────────────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-secondary)" }}
        aria-labelledby="social-proof-heading"
      >
        <div className="mx-auto max-w-6xl px-6 py-14 md:px-10">
          <ScrollReveal>
            <h2 id="social-proof-heading" className="sr-only">Transparency proof</h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 text-center">
              {[
                { stat: "100%", label: "Open Source", sublabel: "All public, all auditable" },
                { stat: "21", label: "Permissions", sublabel: "All testable in the Sandbox" },
                { stat: "0", label: "Shadow Bans", sublabel: "Every action logged in the Mod Ledger" },
                { stat: "0", label: "Algorithms", sublabel: "Your feed is chronological, always" },
              ].map(({ stat, label, sublabel }) => (
                <div key={label}>
                  <p
                    className="text-3xl font-extrabold font-display md:text-4xl"
                    style={{ color: "var(--theme-accent)" }}
                  >
                    {stat}
                  </p>
                  <p
                    className="mt-1 text-sm font-semibold"
                    style={{ color: "var(--theme-text-bright)" }}
                  >
                    {label}
                  </p>
                  <p
                    className="mt-0.5 text-xs"
                    style={{ color: "var(--theme-text-muted)" }}
                  >
                    {sublabel}
                  </p>
                </div>
              ))}
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section
        className="mx-auto max-w-6xl px-6 py-20 text-center md:px-10"
        aria-labelledby="cta-heading"
      >
        <ScrollReveal>
        <div
          className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full mb-5"
          style={{ background: "color-mix(in srgb, var(--theme-accent) 12%, transparent)" }}
          aria-hidden="true"
        >
          <VortexLogo size={40} />
        </div>
        <h2
          id="cta-heading"
          className="mb-3 text-3xl font-bold font-display md:text-4xl"
          style={{ color: "var(--theme-text-bright)" }}
        >
          Your community deserves transparency.
        </h2>
        <p className="mb-8 text-base max-w-md mx-auto" style={{ color: "var(--theme-text-secondary)" }}>
          Free forever. No credit card. Every feature included. Start on our hosted platform
          or deploy your own — the code is open either way.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-lg px-7 py-3.5 font-semibold transition-opacity hover:opacity-90 text-base"
            style={{ background: "var(--theme-accent)", color: "var(--theme-bg-tertiary)" }}
          >
            Start Your Community <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
          <Link
            href="/self-host"
            className="inline-flex items-center gap-2 rounded-lg border px-7 py-3.5 font-semibold transition-colors hover:opacity-80 text-base"
            style={{
              borderColor: "rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)",
              color: "var(--theme-text-primary)",
            }}
          >
            <Server className="h-4 w-4" aria-hidden="true" />
            Deploy Your Own
          </Link>
        </div>
        </ScrollReveal>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-tertiary)" }}
        aria-label="Site footer"
      >
        <div className="mx-auto max-w-6xl px-6 py-10 md:px-10">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            {/* Brand */}
            <div className="max-w-xs">
              <div className="mb-3 flex items-center gap-2">
                <VortexLogo size={28} />
                <span className="font-bold font-display" style={{ color: "var(--theme-text-bright)" }}>
                  VortexChat
                </span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: "var(--theme-text-muted)" }}>
                The transparent community platform. Open-source, fully auditable, and free
                forever — with nothing to hide.
              </p>
            </div>

            {/* Links */}
            <div className="flex flex-wrap gap-x-12 gap-y-6">
              <nav aria-label="Product links">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
                  Product
                </p>
                <ul className="space-y-2">
                  {[
                    { label: "Sign Up", href: "/register" },
                    { label: "Sign In", href: "/login" },
                    { label: "What\u2019s Different", href: "/#how-it-works-heading" },
                    { label: "Built-in Apps", href: "/#apps-heading" },
                    { label: "Themes", href: "/#themes-heading" },
                    { label: "Self-Host", href: "/self-host" },
                  ].map(({ label, href }) => (
                    <li key={label}>
                      <Link
                        href={href}
                        className="text-sm transition-colors hover:opacity-80"
                        style={{ color: "var(--theme-text-secondary)" }}
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>

              <nav aria-label="Resources">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
                  Resources
                </p>
                <ul className="space-y-2">
                  {[
                    { label: "Documentation", href: "https://github.com/TheShield2594/vortexchat/wiki", external: true },
                    { label: "Changelog", href: "https://github.com/TheShield2594/vortexchat/releases", external: true },
                    { label: "Contributing", href: "https://github.com/TheShield2594/vortexchat/blob/main/CONTRIBUTING.md", external: true },
                    { label: "Roadmap", href: "/roadmap", external: false },
                    { label: "Compare", href: "/compare", external: false },
                    { label: "Showcase", href: "/showcase", external: false },
                  ].map(({ label, href, external }) => (
                    <li key={label}>
                      <a
                        href={href}
                        target={external ? "_blank" : undefined}
                        rel={external ? "noopener noreferrer" : undefined}
                        className="inline-flex items-center gap-1 text-sm transition-colors hover:opacity-80"
                        style={{ color: "var(--theme-text-secondary)" }}
                      >
                        {label}
                        {external && <ExternalLink className="h-3 w-3 opacity-50" aria-hidden="true" />}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>

              <nav aria-label="Company links">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
                  Company
                </p>
                <ul className="space-y-2">
                  {[
                    { label: "GitHub", href: "https://github.com/TheShield2594/vortexchat", external: true },
                    { label: "Terms of Service", href: "/terms", external: false },
                    { label: "Privacy Policy", href: "/privacy", external: false },
                  ].map(({ label, href, external }) => (
                    <li key={label}>
                      {external ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm transition-colors hover:opacity-80"
                          style={{ color: "var(--theme-text-secondary)" }}
                        >
                          {label}
                          <ExternalLink className="h-3 w-3 opacity-50" aria-hidden="true" />
                        </a>
                      ) : (
                        <Link
                          href={href}
                          className="text-sm transition-colors hover:opacity-80"
                          style={{ color: "var(--theme-text-secondary)" }}
                        >
                          {label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </div>

          <div
            className="mt-8 flex flex-col gap-2 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between"
            style={{ borderColor: "rgba(255,255,255,0.06)", color: "var(--theme-text-muted)" }}
          >
            <p>© {new Date().getFullYear()} VortexChat. Open source, free forever.</p>
            <p>
              Made with{" "}
              <Heart className="inline h-3 w-3 mx-0.5" style={{ color: "var(--theme-accent-secondary)" }} aria-label="love" />{" "}
              for communities everywhere.
            </p>
          </div>
        </div>
      </footer>
    </main>
  )
}
