"use client"

import { useMemo } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getDiscoverableShortcutMappings, type ShortcutHandlers } from "@/hooks/use-keyboard-shortcuts"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  handlers: ShortcutHandlers
}

export function KeyboardShortcutsModal({ open, onOpenChange, handlers }: Props) {
  const shortcuts = useMemo(() => getDiscoverableShortcutMappings(handlers), [handlers])
  const grouped = useMemo(() => shortcuts.reduce<Record<string, typeof shortcuts>>((acc, shortcut) => {
    if (!acc[shortcut.group]) acc[shortcut.group] = []
    acc[shortcut.group].push(shortcut)
    return acc
  }, {}), [shortcuts])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-zinc-900 border-zinc-700 text-white max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="sr-only">View available keyboard shortcuts</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {Object.entries(grouped).map(([group, entries]) => (
            <section key={group} className="space-y-2">
              <h3 className="text-sm uppercase tracking-wide text-zinc-400">{group}</h3>
              <div className="space-y-2">
                {entries.map((shortcut) => (
                  <div key={shortcut.id} className="flex items-center justify-between rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2">
                    <span className="text-sm text-zinc-200">{shortcut.label}</span>
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                      {shortcut.combos.map((combo) => (
                        <kbd key={combo} className="rounded border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300">
                          {combo}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
