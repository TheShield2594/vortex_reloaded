"use client"

import { ChevronDown, ChevronRight, Plus, Clipboard, Pencil, Trash2, GripVertical } from "lucide-react"
import { useDroppable } from "@dnd-kit/core"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@/lib/utils/cn"
import type { ChannelRow } from "@/types/database"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu"

const CATEGORY_DRAG_PREFIX = "category:"

export function getCategoryDragId(categoryId: string): string {
  return `${CATEGORY_DRAG_PREFIX}${categoryId}`
}

export function getCategoryIdFromDragId(id: string): string | null {
  return id.startsWith(CATEGORY_DRAG_PREFIX) ? id.slice(CATEGORY_DRAG_PREFIX.length) : null
}

interface CategoryHeaderProps {
  category: ChannelRow
  containerId: string
  isCollapsed: boolean
  canManageChannels: boolean
  isDragOver: boolean
  onToggle: () => void
  onAddChannel: () => void
  onEdit?: () => void
  onDelete?: () => void
  onCopyId?: () => void
}

export function CategoryHeader({
  category,
  containerId,
  isCollapsed,
  canManageChannels,
  isDragOver,
  onToggle,
  onAddChannel,
  onEdit,
  onDelete,
  onCopyId,
}: CategoryHeaderProps): React.ReactElement {
  const { setNodeRef } = useDroppable({ id: containerId })
  const sortable = useSortable({ id: getCategoryDragId(category.id), disabled: !canManageChannels })
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.4 : 1,
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={sortable.setNodeRef}
          style={style}
          className={cn(
            "flex items-center justify-between px-2 py-2 md:py-1 group rounded mx-1 motion-interactive",
            isDragOver && "surface-hover"
          )}
        >
          <button
            ref={setNodeRef}
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1 flex-1 min-w-0 min-h-[44px] text-left focus-ring rounded-sm"
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} category ${category.name}`}
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4 md:w-3 md:h-3 tertiary-metadata" />
            ) : (
              <ChevronDown className="w-4 h-4 md:w-3 md:h-3 tertiary-metadata" />
            )}
            <span className="text-sm md:text-xs font-semibold uppercase tracking-wider tertiary-metadata truncate">
              {category.name}
            </span>
          </button>
          {canManageChannels && (
            <div className="flex items-center">
              <span
                {...sortable.attributes}
                {...sortable.listeners}
                className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto touch-visible cursor-grab active:cursor-grabbing tertiary-metadata"
                onClick={(event) => event.stopPropagation()}
              >
                <GripVertical className="w-3 h-3" />
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onAddChannel() }}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-interactive motion-interactive focus-ring rounded-sm" aria-label={`Create channel in ${category.name}`}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Create Channel</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-56" aria-label={`Category actions for ${category.name}`}>
        {canManageChannels && (
          <>
            <ContextMenuItem onClick={onAddChannel}>
              <Plus className="w-4 h-4 mr-2" /> Create Channel
            </ContextMenuItem>
            {(onEdit || onCopyId || onDelete) && <ContextMenuSeparator />}
          </>
        )}
        {canManageChannels && onEdit && (
          <ContextMenuItem onClick={onEdit}>
            <Pencil className="w-4 h-4 mr-2" /> Edit Category
          </ContextMenuItem>
        )}
        {onCopyId && (
          <ContextMenuItem onClick={onCopyId}>
            <Clipboard className="w-4 h-4 mr-2" /> Copy Category ID
          </ContextMenuItem>
        )}
        {canManageChannels && onDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="w-4 h-4 mr-2" /> Delete Category
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Empty drop zone for uncategorized channels. */
export function DropContainer({ id }: { id: string }): React.ReactElement {
  const { setNodeRef } = useDroppable({ id })
  return <div ref={setNodeRef} className="h-0" aria-hidden />
}
