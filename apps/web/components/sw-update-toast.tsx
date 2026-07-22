"use client"

import { useEffect } from "react"
import { useSwRegistration } from "@/hooks/use-sw-registration"
import { useToast } from "@/components/ui/use-toast"
import { ToastAction } from "@/components/ui/toast"

/**
 * Listens for service worker updates and shows a persistent toast
 * prompting the user to refresh for the latest version.
 */
export function SwUpdateToast() {
  const { updateAvailable, applyUpdate } = useSwRegistration()
  const { toast } = useToast()

  useEffect(() => {
    if (!updateAvailable) return

    toast({
      title: "Update available",
      description: "A new version of VortexChat is ready.",
      duration: Infinity,
      action: (
        <ToastAction altText="Refresh to update" onClick={applyUpdate}>
          Refresh
        </ToastAction>
      ),
    })
  }, [updateAvailable, applyUpdate, toast])

  return null
}
