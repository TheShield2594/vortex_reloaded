"use client"

import { useState, useRef, useEffect } from "react"

export function useFilePreview() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (preview && preview.startsWith("blob:")) URL.revokeObjectURL(preview)
    }
  }, [preview])

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(URL.createObjectURL(f))
  }

  function reset() {
    if (preview && preview.startsWith("blob:")) URL.revokeObjectURL(preview)
    setFile(null)
    setPreview(null)
  }

  return { file, preview, inputRef, onFileChange, reset }
}
