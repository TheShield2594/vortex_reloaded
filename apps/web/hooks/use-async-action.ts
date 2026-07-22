"use client"

import { useState } from "react"
import { useToast } from "@/components/ui/use-toast"

export function useAsyncAction() {
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  async function run(fn: () => Promise<void>, errorTitle = "Operation failed") {
    setLoading(true)
    try {
      await fn()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred"
      toast({ variant: "destructive", title: errorTitle, description: message })
    } finally {
      setLoading(false)
    }
  }

  return { loading, run }
}
