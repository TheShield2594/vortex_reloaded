import { DialogContent } from "@/components/ui/dialog"

interface ThemedDialogContentProps {
  maxWidth?: string
  children: React.ReactNode
}

export function ThemedDialogContent({ maxWidth = "440px", children }: ThemedDialogContentProps) {
  return (
    <DialogContent style={{ background: 'var(--theme-bg-primary)', borderColor: 'var(--theme-bg-tertiary)', maxWidth }}>
      {children}
    </DialogContent>
  )
}
