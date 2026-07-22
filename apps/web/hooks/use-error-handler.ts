"use client"

import { useCallback, useMemo } from "react"
import { toast } from "@/components/ui/use-toast"

interface ErrorHandlerOptions {
  /** Fallback title when the error has no message. */
  fallbackTitle?: string
  /** Silently log instead of showing a toast. */
  silent?: boolean
}

type ErrorHandler = {
  (error: unknown, opts?: ErrorHandlerOptions): void
  /** Convenience wrapper that pre-fills context for `.catch()` chains. */
  withContext: (title: string, opts?: Omit<ErrorHandlerOptions, "fallbackTitle">) => (error: unknown) => void
}

function handleError(error: unknown, opts?: ErrorHandlerOptions) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "An unexpected error occurred"

  if (opts?.silent) {
    console.error("[VortexChat]", message, error)
    return
  }

  toast({
    variant: "destructive",
    title: opts?.fallbackTitle ?? "Something went wrong",
    description: message,
  })
}

/**
 * Returns a callback that surfaces errors via the toast system.
 *
 * Usage:
 *   const handleError = useErrorHandler()
 *   fetch(url).catch(handleError)
 *   // or with context:
 *   fetch(url).catch(handleError.withContext("Failed to load members"))
 */
export function useErrorHandler(): ErrorHandler {
  return useMemo(() => {
    const fn = ((error: unknown, opts?: ErrorHandlerOptions) => {
      handleError(error, opts)
    }) as ErrorHandler

    fn.withContext = (title: string, opts?: Omit<ErrorHandlerOptions, "fallbackTitle">) => {
      return (error: unknown) => handleError(error, { ...opts, fallbackTitle: title })
    }

    return fn
  }, [])
}

/**
 * Fire-and-forget helper for non-hook contexts (event handlers, callbacks).
 * Shows a destructive toast on failure.
 */
export function showError(error: unknown, title?: string) {
  handleError(error, { fallbackTitle: title })
}
