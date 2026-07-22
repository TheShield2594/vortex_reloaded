"use client"

import * as React from "react"
import Image from "next/image"
import { cn } from "@/lib/utils/cn"

/**
 * Drop-in replacement for AvatarImage that uses next/image for automatic
 * WebP conversion, responsive sizing, and blur placeholders.
 *
 * Must be placed inside an Avatar root (which provides a sized container).
 */

interface OptimizedAvatarImageProps {
  src: string
  alt?: string
  /** Avatar display size in pixels — used to generate optimal srcSet. Defaults to 40. */
  size?: number
  className?: string
}

const OptimizedAvatarImage = React.forwardRef<HTMLImageElement, OptimizedAvatarImageProps>(
  ({ src, alt = "", size = 40, className }, ref) => {
    return (
      <Image
        ref={ref}
        src={src}
        alt={alt}
        width={size}
        height={size}
        sizes={`${size}px`}
        className={cn("aspect-square h-full w-full rounded-full object-cover", className)}
        unoptimized={!src.includes("supabase")}
      />
    )
  }
)
OptimizedAvatarImage.displayName = "OptimizedAvatarImage"

export { OptimizedAvatarImage }
