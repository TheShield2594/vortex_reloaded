"use client"

import dynamic from "next/dynamic"
import type { ComponentProps, JSX } from "react"
import type { VoiceChannel } from "@/components/voice/voice-channel"
import { ErrorBoundary } from "@/components/ui/error-boundary"

type VoiceChannelProps = ComponentProps<typeof VoiceChannel>

const VoiceChannelDynamic = dynamic<VoiceChannelProps>(
  () => import("@/components/voice/voice-channel").then((m) => m.VoiceChannel),
  { ssr: false },
)

/** Client-side lazy wrapper for VoiceChannel — keeps the ~600 KB livekit-client
 *  dependency out of the initial JS bundle by disabling SSR.
 *  Wrapped in an ErrorBoundary so voice failures don't crash the whole app. */
export function VoiceChannelLazy(props: VoiceChannelProps): JSX.Element {
  return (
    <ErrorBoundary>
      <VoiceChannelDynamic {...props} />
    </ErrorBoundary>
  )
}
