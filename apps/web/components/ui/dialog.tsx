"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils/cn"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-overlay dialog-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DISMISS_THRESHOLD = 60

/** Drag handle with swipe-to-dismiss for mobile bottom sheet. */
function SheetDragHandle({ contentRef }: { contentRef: React.RefObject<HTMLDivElement | null> }): React.ReactElement {
  const startYRef = React.useRef<number | null>(null)
  const draggingRef = React.useRef(false)

  const onTouchStart = React.useCallback((e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY
    draggingRef.current = false
  }, [])

  const onTouchMove = React.useCallback((e: React.TouchEvent) => {
    if (startYRef.current === null) return
    const dy = e.touches[0].clientY - startYRef.current
    if (dy > 0) {
      draggingRef.current = true
      const el = contentRef.current
      if (el) {
        el.style.transition = "none"
        el.style.transform = `translateY(${dy}px)`
        el.style.opacity = `${Math.max(1 - dy / 300, 0.5)}`
      }
    }
  }, [contentRef])

  const onTouchEnd = React.useCallback(() => {
    const el = contentRef.current
    if (!el || startYRef.current === null) return
    if (draggingRef.current) {
      const currentY = parseFloat(el.style.transform.replace(/[^0-9.-]/g, "")) || 0
      if (currentY >= DISMISS_THRESHOLD) {
        // Dismiss: find and click the close button
        const closeBtn = el.querySelector<HTMLButtonElement>("[aria-label='Close dialog']")
        if (closeBtn) {
          closeBtn.click()
        }
      } else {
        // Snap back
        el.style.transition = "transform 200ms ease-out, opacity 200ms ease-out"
        el.style.transform = ""
        el.style.opacity = ""
      }
    }
    startYRef.current = null
    draggingRef.current = false
  }, [contentRef])

  const onTouchCancel = React.useCallback(() => {
    const el = contentRef.current
    if (el) {
      el.style.transition = "transform 200ms ease-out, opacity 200ms ease-out"
      el.style.transform = ""
      el.style.opacity = ""
    }
    startYRef.current = null
    draggingRef.current = false
  }, [contentRef])

  return (
    <div
      className="sm:hidden flex justify-center -mt-2 mb-1 cursor-grab active:cursor-grabbing py-2 -my-2"
      aria-hidden
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      <div className="w-10 h-1 rounded-full bg-white/20" />
    </div>
  )
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(({ className, children, hideClose, ...props }, ref) => {
  const internalRef = React.useRef<HTMLDivElement | null>(null)

  const setRefs = React.useCallback((node: HTMLDivElement | null) => {
    internalRef.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
  }, [ref])

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setRefs}
        className={cn(
          // ── Mobile: bottom-sheet style ──
          "fixed inset-x-0 bottom-0 z-overlay grid w-full gap-4 border-t bg-background p-6 elevation-4 surface-active surface-focus-shift duration-200 rounded-t-2xl max-h-[85dvh] overflow-y-auto",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full",
          // ── Desktop (sm+): centered dialog ──
          "sm:inset-auto sm:left-[50%] sm:top-[50%] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border sm:border-t sm:max-h-none sm:overflow-visible",
          "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
          "sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%]",
          "sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]",
          "sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:slide-out-to-bottom-0",
          className
        )}
        {...props}
      >
        {/* Drag handle for mobile bottom sheet — functional swipe-to-dismiss */}
        <SheetDragHandle contentRef={internalRef} />
        {children}
        <DialogPrimitive.Close
          className={cn(
            "absolute right-2 top-2 sm:right-4 sm:top-4 rounded-md min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center surface-muted-fg ring-offset-background transition-opacity hover:opacity-100 hover:bg-white/10 active:bg-white/15 focus-ring disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground",
            hideClose && "opacity-0 pointer-events-none"
          )}
          aria-label="Close dialog"
          tabIndex={hideClose ? -1 : undefined}
        >
          <X className="h-5 w-5 sm:h-4 sm:w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog, DialogPortal, DialogOverlay, DialogClose, DialogTrigger,
  DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
}