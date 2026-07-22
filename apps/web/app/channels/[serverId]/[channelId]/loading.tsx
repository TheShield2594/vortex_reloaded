import { MessageListSkeleton } from "@/components/ui/skeleton"

export default function ChannelLoading() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "var(--theme-bg-primary)" }}>
      {/* Channel header skeleton */}
      <div
        className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: "var(--theme-bg-tertiary)", background: "var(--theme-bg-secondary)" }}
      >
        <div className="skeleton-shimmer h-4 w-4 rounded" aria-hidden="true" />
        <div className="skeleton-shimmer h-4 w-32 rounded" aria-hidden="true" />
      </div>
      {/* Message list skeleton */}
      <div className="flex-1 overflow-hidden">
        <MessageListSkeleton count={8} />
      </div>
      {/* Input skeleton */}
      <div className="px-4 py-3 flex-shrink-0">
        <div
          className="skeleton-shimmer h-11 w-full rounded-lg"
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
