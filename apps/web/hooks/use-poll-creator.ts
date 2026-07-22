"use client"

import { useState, useCallback } from "react"

/** Maximum number of poll options — must match the length of POLL_NUMBER_EMOJIS in message-item.tsx */
export const MAX_POLL_OPTIONS = 8

interface UsePollCreatorOptions {
  content: string
  onContentChange: (content: string) => void
  onCursorChange: (position: number) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

interface UsePollCreatorReturn {
  showPollCreator: boolean
  setShowPollCreator: (show: boolean) => void
  pollQuestion: string
  setPollQuestion: (question: string) => void
  pollOptions: string[]
  setPollOptions: React.Dispatch<React.SetStateAction<string[]>>
  canInsertPoll: boolean
  maxPollOptions: number
  addPollOption: () => void
  handleCreatePoll: () => void
  handlePollInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  removePollOption: (index: number) => void
  resetPollDraftToBlank: () => void
  openPollCreator: (initialQuestion?: string) => void
}

export function usePollCreator({ content, onContentChange, onCursorChange, textareaRef }: UsePollCreatorOptions): UsePollCreatorReturn {
  const [showPollCreator, setShowPollCreator] = useState(false)
  const [pollQuestion, setPollQuestion] = useState("")
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""])

  const canInsertPoll = pollQuestion.trim().length > 0 && pollOptions.filter((option) => option.trim().length > 0).length >= 2

  const resetPollDraftToBlank = useCallback((): void => {
    setPollQuestion("")
    setPollOptions(["", ""])
  }, [])

  const handleCreatePoll = useCallback((): void => {
    const question = pollQuestion.trim()
    const options = pollOptions.map((option) => option.trim()).filter(Boolean).slice(0, MAX_POLL_OPTIONS)
    if (!question || options.length < 2) return

    const pollBlock = ["[POLL]", question, ...options.map((option) => `- ${option}`), "[/POLL]"].join("\n")
    const spacer = content.trim() ? "\n\n" : ""
    const next = `${content}${spacer}${pollBlock}`
    onContentChange(next)
    onCursorChange(next.length)
    setShowPollCreator(false)
    setPollQuestion("")
    setPollOptions(["", ""])
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      if (textareaRef.current) {
        textareaRef.current.selectionStart = next.length
        textareaRef.current.selectionEnd = next.length
      }
    })
  }, [pollQuestion, pollOptions, content, onContentChange, onCursorChange, textareaRef])

  const handlePollInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter" || event.shiftKey) return
    if (!canInsertPoll) return
    event.preventDefault()
    handleCreatePoll()
  }, [canInsertPoll, handleCreatePoll])

  const addPollOption = useCallback((): void => {
    setPollOptions((prev) => prev.length >= MAX_POLL_OPTIONS ? prev : [...prev, ""])
  }, [])

  const removePollOption = useCallback((index: number): void => {
    setPollOptions((prev) => {
      if (prev.length <= 2) return prev
      return prev.filter((_, optionIndex) => optionIndex !== index)
    })
  }, [])

  const openPollCreator = useCallback((initialQuestion?: string): void => {
    setPollOptions((prev) => prev.length === 0 ? ["", ""] : prev)
    if (initialQuestion !== undefined) setPollQuestion(initialQuestion)
    setShowPollCreator(true)
  }, [])

  return {
    showPollCreator, setShowPollCreator,
    pollQuestion, setPollQuestion,
    pollOptions, setPollOptions,
    canInsertPoll,
    maxPollOptions: MAX_POLL_OPTIONS,
    addPollOption,
    handleCreatePoll,
    handlePollInputKeyDown,
    removePollOption,
    resetPollDraftToBlank,
    openPollCreator,
  }
}
