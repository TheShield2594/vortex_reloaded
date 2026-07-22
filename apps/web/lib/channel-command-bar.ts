export type CommandGroup = "search" | "pins" | "threads" | "inbox" | "voice" | "help"

export interface CommandActionDescriptor {
  id: string
  group: CommandGroup
  priority: number
}

export interface CommandBarLayout {
  visibleActionIds: string[]
  overflowActionIds: string[]
}

function resolveVisibleCount(viewportWidth: number): number {
  if (viewportWidth >= 1536) return 8
  if (viewportWidth >= 1280) return 7
  if (viewportWidth >= 1024) return 6
  if (viewportWidth >= 768) return 5
  return 4
}

export function resolveCommandBarLayout(viewportWidth: number, actions: CommandActionDescriptor[]): CommandBarLayout {
  const sorted = [...actions].sort((a, b) => a.priority - b.priority)
  const visibleCount = resolveVisibleCount(viewportWidth)
  const visibleActionIds = sorted.slice(0, visibleCount).map((action) => action.id)
  const overflowActionIds = sorted.slice(visibleCount).map((action) => action.id)
  return { visibleActionIds, overflowActionIds }
}
