"use client"

import { useState, useCallback } from "react"

type EmojiPickerType = (typeof import("frimousse"))["EmojiPicker"]

let _cached: EmojiPickerType | null = null
let _promise: Promise<EmojiPickerType> | null = null

function load(): Promise<EmojiPickerType> {
  if (!_promise) {
    _promise = import("frimousse")
      .then((m) => {
        _cached = m.EmojiPicker
        return m.EmojiPicker
      })
      .catch((error) => {
        // Reset so future attempts can retry
        _promise = null
        throw error
      })
  }
  return _promise
}

/** Lazy-loads the frimousse EmojiPicker compound component on first request.
 *  The module is cached at the module level so subsequent calls are instant. */
export function useLazyEmojiPicker(): {
  EmojiPicker: EmojiPickerType | null
  loadEmojiPicker: () => Promise<void>
  isLoaded: boolean
} {
  const [picker, setPicker] = useState<EmojiPickerType | null>(_cached)

  const loadEmojiPicker = useCallback(async (): Promise<void> => {
    try {
      const mod = _cached ?? await load()
      setPicker(() => mod)
    } catch {
      // Import failed — picker stays null, user can retry
      setPicker(null)
    }
  }, [])

  return { EmojiPicker: picker, loadEmojiPicker, isLoaded: picker !== null }
}
