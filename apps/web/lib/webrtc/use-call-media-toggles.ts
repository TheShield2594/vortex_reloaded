import { useCallback, type Dispatch, type SetStateAction } from "react"

interface UseCallMediaTogglesOptions {
  muted: boolean
  videoOff: boolean
  setMuted: Dispatch<SetStateAction<boolean>>
  setVideoOff: Dispatch<SetStateAction<boolean>>
  onToggleMute?: (muted: boolean) => void
  onToggleVideo?: (videoOff: boolean) => void
}

export function useCallMediaToggles({
  muted,
  videoOff,
  setMuted,
  setVideoOff,
  onToggleMute,
  onToggleVideo,
}: UseCallMediaTogglesOptions) {
  const toggleMute = useCallback(() => {
    onToggleMute?.(muted)
    setMuted((prev) => !prev)
  }, [muted, onToggleMute, setMuted])

  const toggleVideo = useCallback(() => {
    onToggleVideo?.(videoOff)
    setVideoOff((prev) => !prev)
  }, [onToggleVideo, setVideoOff, videoOff])

  return { toggleMute, toggleVideo }
}
