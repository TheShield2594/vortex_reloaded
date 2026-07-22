import { cn } from "@/lib/utils/cn"

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer rounded-md", className)} aria-hidden="true" />
}

/** A single message row skeleton: avatar circle + two text lines. */
export function MessageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-start gap-3 px-4 py-1", className)} aria-hidden="true">
      <Skeleton className="h-9 w-9 flex-shrink-0 rounded-full" />
      <div className="flex-1 space-y-1.5 pt-0.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-10 opacity-60" />
        </div>
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2 opacity-70" />
      </div>
    </div>
  )
}

/** Stacked message skeletons mimicking a conversation loading state. */
export function MessageListSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("skeleton-stagger space-y-3 py-4", className)} aria-busy="true" aria-label="Loading messages">
      {Array.from({ length: count }).map((_, i) => (
        <MessageSkeleton key={i} />
      ))}
    </div>
  )
}

/** A single member-list row skeleton: avatar + name. */
export function MemberSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 px-3 py-1.5", className)} aria-hidden="true">
      <Skeleton className="h-8 w-8 flex-shrink-0 rounded-full" />
      <div className="flex-1 space-y-1">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-2.5 w-28 opacity-70" />
      </div>
    </div>
  )
}

/** A single channel/DM row skeleton: avatar + name + preview line. */
export function ChannelRowSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-md px-2 py-1.5", className)} aria-hidden="true">
      <Skeleton className="h-8 w-8 flex-shrink-0 rounded-full" />
      <div className="flex-1 space-y-1">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-2.5 w-32 opacity-70" />
      </div>
    </div>
  )
}

