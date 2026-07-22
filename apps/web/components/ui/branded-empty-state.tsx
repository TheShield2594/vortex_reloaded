import type { LucideIcon } from "lucide-react"

interface Props {
  icon: LucideIcon
  title: string
  description: string
  hint?: string
}

export function BrandedEmptyState({ icon: Icon, title, description, hint }: Props) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-2xl border border-white/10 px-6 py-10 text-center" style={{ background: "var(--theme-bg-tertiary)" }}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: "color-mix(in srgb, var(--theme-accent) 20%, transparent)", color: "var(--theme-accent)" }}>
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm" style={{ color: "var(--theme-text-secondary)" }}>{description}</p>
      {hint && <p className="mt-3 text-xs" style={{ color: "var(--theme-text-muted)" }}>{hint}</p>}
    </div>
  )
}

