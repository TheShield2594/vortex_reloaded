import { MeShell } from "@/components/dm/me-shell"

export default function MeLayout({ children }: { children: React.ReactNode }) {
  return <MeShell>{children}</MeShell>
}
