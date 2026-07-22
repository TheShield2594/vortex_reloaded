import Link from "next/link"
import type { Metadata } from "next"
import { CheckCircle2, ExternalLink } from "lucide-react"
import { VortexLogo } from "@/components/ui/vortex-logo"

export const metadata: Metadata = {
  title: "VortexChat Roadmap — What We're Building Next",
  description:
    "VortexChat's public roadmap. See what's shipped, what's in progress, and what's coming next. Nothing to hide — not even the plan.",
}

// ── Data ──────────────────────────────────────────────────────────────────────

type ItemStatus = "done" | "in-progress" | "planned"

interface RoadmapItem {
  title: string
  description: string
  status: ItemStatus
  category: string
}

const roadmapItems: RoadmapItem[] = [
  // ── Shipped ─────────────────────────────────────────────────────────────────
  { title: "Custom emoji system", description: "Upload, autocomplete, manage, and use custom emoji server-wide and in DMs.", status: "done", category: "Chat" },
  { title: "GIF & sticker picker", description: "Klipy-powered search with Giphy fallback. Unified tabbed picker for emoji, GIFs, and stickers.", status: "done", category: "Chat" },
  { title: "Voice channels + compact view", description: "WebRTC voice via Socket.IO signaling with screen share and system audio.", status: "done", category: "Voice" },
  { title: "Vortex Recap (Voice Intelligence)", description: "AI transcripts and summaries posted as recap cards after voice sessions.", status: "done", category: "Voice" },
  { title: "Mod Ledger (Audit trail)", description: "30+ action types logged. Full moderation timeline with actor, target, reason, timestamp.", status: "done", category: "Moderation" },
  { title: "Permission Sandbox", description: "Preview effective permissions for any role before applying changes to real users.", status: "done", category: "Moderation" },
  { title: "Transparency Panel", description: "Right-click channels or roles to see visibility, recent actions, and permission details.", status: "done", category: "Moderation" },
  { title: "Community Health dashboard", description: "Member trends, mod action frequency, active channels, permission conflict warnings.", status: "done", category: "Moderation" },
  { title: "Built-in app platform", description: "5 verified apps (Welcome Bot, Giveaway Bot, Standup Assistant, Incident Bot, Reminder Bot) with marketplace and slash commands.", status: "done", category: "Platform" },
  { title: "Blueprints (Server templates)", description: "JSON import/export with diff preview. Pre-built templates for Gaming, Study, Startup, Creator.", status: "done", category: "Platform" },
  { title: "Ephemeral channels", description: "Auto-expiring channels that clean up after themselves.", status: "done", category: "Platform" },
  { title: "PWA + mobile experience", description: "Installable PWA with push notifications, offline queue, bottom tab bar, splash screens, app badges.", status: "done", category: "Mobile" },
  { title: "E2EE on DMs", description: "Optional end-to-end encryption on direct messages with client-side encrypted search.", status: "done", category: "Privacy" },
  { title: "GDPR data export", description: "One-click JSON download of profile, messages, DMs, friends, servers, and reactions.", status: "done", category: "Privacy" },
  { title: "11 hand-crafted themes", description: "Midnight Neon, Synthwave, Terminal, Sakura Blossom, and more. Theme-as-identity on profiles.", status: "done", category: "Design" },
  { title: "Email verification & CSRF protection", description: "Enforced email verification, origin validation, request size limits, input hardening.", status: "done", category: "Security" },
  { title: "Onboarding flow", description: "Welcome screen, template selector, server creation wizard, invite link step, system bot greeting.", status: "done", category: "UX" },
  { title: "Thread auto-archive", description: "Configurable auto-archive durations (1h to 1w). Auto-unarchive on new messages.", status: "done", category: "Chat" },
  { title: "Quiet hours", description: "Scheduled notification suppression with timezone-aware start/end times.", status: "done", category: "Notifications" },
  { title: "Screen reader live regions", description: "aria-live announcements for incoming messages. Accessible message container with role=log.", status: "done", category: "Accessibility" },

  // ── In Progress ─────────────────────────────────────────────────────────────
  { title: "Competitive comparison page", description: "Feature-by-feature comparison vs Discord, Revolt, Matrix, Rocket.Chat.", status: "in-progress", category: "Brand" },
  { title: "Self-host deployment guides", description: "Docker Compose, Railway, and Vercel deploy paths with cost estimates.", status: "in-progress", category: "Platform" },
  { title: "Community showcase page", description: "Highlight real communities using VortexChat with testimonials.", status: "in-progress", category: "Brand" },

  // ── Planned ─────────────────────────────────────────────────────────────────
  { title: "Memes picker tab", description: "Fourth tab in the unified media picker for meme templates and search.", status: "planned", category: "Chat" },
  { title: "Internal code rebrand", description: "Rename internal files and types to match branded terminology (Recap, Sandbox, Ledger).", status: "planned", category: "Code Quality" },
  { title: "Community voting on features", description: "Let users upvote and comment on roadmap items directly.", status: "planned", category: "Community" },
  { title: "Desktop app (Electron/Tauri)", description: "Native desktop wrapper for Windows, macOS, and Linux.", status: "planned", category: "Platform" },
  { title: "Mobile app (React Native)", description: "Native mobile app sharing core logic with the web PWA.", status: "planned", category: "Mobile" },
]

const statusConfig: Record<ItemStatus, { label: string; color: string; bg: string }> = {
  done: { label: "Shipped", color: "#3ddc97", bg: "rgba(61,220,151,0.1)" },
  "in-progress": { label: "In Progress", color: "#00e5ff", bg: "rgba(0,229,255,0.1)" },
  planned: { label: "Planned", color: "#ffb84d", bg: "rgba(255,184,77,0.1)" },
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RoadmapPage(): React.JSX.Element {
  const shipped = roadmapItems.filter((i) => i.status === "done")
  const inProgress = roadmapItems.filter((i) => i.status === "in-progress")
  const planned = roadmapItems.filter((i) => i.status === "planned")

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

        <div
          className="mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-widest"
          style={{
            borderColor: "color-mix(in srgb, var(--theme-accent) 25%, transparent)",
            background: "color-mix(in srgb, var(--theme-accent) 8%, transparent)",
            color: "var(--theme-accent)",
          }}
        >
          Nothing to hide — not even the plan
        </div>

        <h1
          className="text-3xl font-extrabold leading-[1.1] tracking-tight font-display md:text-5xl"
          style={{ color: "var(--theme-text-bright)" }}
        >
          Public{" "}
          <span style={{ color: "var(--theme-accent)" }}>Roadmap</span>
        </h1>

        <p
          className="mt-4 max-w-2xl text-lg leading-relaxed"
          style={{ color: "var(--theme-text-secondary)" }}
        >
          Everything we&apos;ve shipped, what we&apos;re building now, and where we&apos;re
          headed. Transparency isn&apos;t just a feature — it&apos;s how we work.
        </p>

        {/* Status legend */}
        <div className="mt-6 flex flex-wrap gap-4">
          {(["done", "in-progress", "planned"] as ItemStatus[]).map((status) => {
            const cfg = statusConfig[status]
            return (
              <div key={status} className="flex items-center gap-2 text-sm">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: cfg.color }}
                  aria-hidden="true"
                />
                <span style={{ color: cfg.color }} className="font-medium">
                  {cfg.label}
                </span>
                <span style={{ color: "var(--theme-text-muted)" }}>
                  ({status === "done" ? shipped.length : status === "in-progress" ? inProgress.length : planned.length})
                </span>
              </div>
            )
          })}
        </div>
      </header>

      {/* ── In Progress ────────────────────────────────────────────────── */}
      {inProgress.length > 0 && (
        <section
          className="border-t"
          style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-secondary)" }}
        >
          <div className="mx-auto max-w-5xl px-6 py-12 md:px-10">
            <h2
              className="mb-6 text-xl font-bold font-display flex items-center gap-2"
              style={{ color: statusConfig["in-progress"].color }}
            >
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: statusConfig["in-progress"].color }} aria-hidden="true" />
              In Progress
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {inProgress.map(({ title, description, category }) => (
                <div
                  key={title}
                  className="rounded-xl border p-5"
                  style={{ borderColor: "rgba(0,229,255,0.18)", background: "var(--theme-bg-primary)" }}
                >
                  <span
                    className="mb-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{ background: "rgba(0,229,255,0.1)", color: "#00e5ff" }}
                  >
                    {category}
                  </span>
                  <h3 className="mb-1 font-semibold font-display" style={{ color: "var(--theme-text-bright)" }}>
                    {title}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--theme-text-secondary)" }}>
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Planned ────────────────────────────────────────────────────── */}
      {planned.length > 0 && (
        <section
          className="border-t"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <div className="mx-auto max-w-5xl px-6 py-12 md:px-10">
            <h2
              className="mb-6 text-xl font-bold font-display flex items-center gap-2"
              style={{ color: statusConfig.planned.color }}
            >
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: statusConfig.planned.color }} aria-hidden="true" />
              Planned
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {planned.map(({ title, description, category }) => (
                <div
                  key={title}
                  className="rounded-xl border p-5"
                  style={{ borderColor: "rgba(255,184,77,0.18)", background: "var(--theme-bg-secondary)" }}
                >
                  <span
                    className="mb-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{ background: "rgba(255,184,77,0.1)", color: "#ffb84d" }}
                  >
                    {category}
                  </span>
                  <h3 className="mb-1 font-semibold font-display" style={{ color: "var(--theme-text-bright)" }}>
                    {title}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--theme-text-secondary)" }}>
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Shipped ────────────────────────────────────────────────────── */}
      <section
        className="border-t"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-secondary)" }}
      >
        <div className="mx-auto max-w-5xl px-6 py-12 md:px-10">
          <h2
            className="mb-6 text-xl font-bold font-display flex items-center gap-2"
            style={{ color: statusConfig.done.color }}
          >
            <CheckCircle2 className="h-5 w-5" style={{ color: statusConfig.done.color }} aria-hidden="true" />
            Shipped
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shipped.map(({ title, description, category }) => (
              <div
                key={title}
                className="rounded-lg border p-4"
                style={{ borderColor: "rgba(255,255,255,0.06)", background: "var(--theme-bg-primary)" }}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "#3ddc97" }} aria-hidden="true" />
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{ background: "rgba(61,220,151,0.08)", color: "var(--theme-text-muted)" }}
                  >
                    {category}
                  </span>
                </div>
                <h3 className="mb-0.5 text-sm font-semibold font-display" style={{ color: "var(--theme-text-bright)" }}>
                  {title}
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: "var(--theme-text-muted)" }}>
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Contribute ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 py-14 text-center md:px-10">
        <h2
          className="mb-3 text-2xl font-bold font-display"
          style={{ color: "var(--theme-text-bright)" }}
        >
          Have an idea?
        </h2>
        <p className="mb-6 text-sm max-w-md mx-auto" style={{ color: "var(--theme-text-secondary)" }}>
          VortexChat is built in the open. Feature requests, bug reports, and pull requests
          are all welcome.
        </p>
        <a
          href="https://github.com/TheShield2594/vortexchat/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg px-7 py-3 font-semibold transition-opacity hover:opacity-90"
          style={{ background: "var(--theme-accent)", color: "var(--theme-bg-tertiary)" }}
        >
          Open an Issue on GitHub
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
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
              <Link href="/compare" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>Compare</Link>
              <Link href="/self-host" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>Self-Host</Link>
              <Link href="/terms" className="hover:underline" style={{ color: "var(--theme-text-secondary)" }}>Terms</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
