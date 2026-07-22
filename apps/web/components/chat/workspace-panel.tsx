"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckSquare, ChevronDown, ChevronRight, FileText, Plus, Square, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"

type Task = { id: string; title: string; status: string; due_date: string | null }
type Doc = { id: string; title: string; updated_at: string }

export function WorkspacePanel({ channelId, open, onClose }: { channelId: string; open: boolean; onClose: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [taskTitle, setTaskTitle] = useState("")
  const [docTitle, setDocTitle] = useState("")
  const [showCompleted, setShowCompleted] = useState(false)

  async function load() {
    const [tasksRes, docsRes] = await Promise.all([
      fetch(`/api/channels/${channelId}/tasks`),
      fetch(`/api/channels/${channelId}/docs`),
    ])
    if (tasksRes.ok) setTasks((await tasksRes.json()).tasks ?? [])
    if (docsRes.ok) setDocs((await docsRes.json()).docs ?? [])
  }

  async function deleteTask(taskId: string) {
    const res = await fetch(`/api/channels/${channelId}/tasks`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    })
    if (res.ok) setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  async function toggleTaskStatus(taskId: string, currentStatus: string) {
    const newStatus = currentStatus === "done" ? "todo" : "done"
    const res = await fetch(`/api/channels/${channelId}/tasks`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, status: newStatus }),
    })
    if (res.ok) setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: newStatus } : t))
  }

  const activeTasks = useMemo(() => tasks.filter((t) => t.status !== "done"), [tasks])
  const completedTasks = useMemo(() => tasks.filter((t) => t.status === "done"), [tasks])

  async function deleteDoc(docId: string) {
    const res = await fetch(`/api/channels/${channelId}/docs`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId }),
    })
    if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== docId))
  }

  useEffect(() => { if (open) void load() }, [open, channelId])
  if (!open) return null

  return (
    <aside className="w-80 border-l border-white/10 bg-[#1f2126] p-3 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Workspace</h2>
        <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-200" aria-label="Close workspace">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-white"><CheckSquare className="w-4 h-4" /> Tasks</div>
        <div className="flex gap-2 mb-2">
          <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="New task" className="flex-1 bg-black/30 rounded px-2 py-1 text-sm" />
          <Button size="sm" aria-label="Add task" onClick={async () => {
            if (!taskTitle.trim()) return
            await fetch(`/api/channels/${channelId}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: taskTitle }) })
            setTaskTitle("")
            await load()
          }}><Plus className="w-3 h-3" /></Button>
        </div>
        <div className="space-y-1">
          {activeTasks.map((task) => (
            <div key={task.id} className="group flex items-start gap-2 rounded bg-black/20 p-2 text-xs text-zinc-200">
              <button
                type="button"
                onClick={() => toggleTaskStatus(task.id, task.status)}
                className="text-zinc-500 hover:text-zinc-200 shrink-0 mt-0.5"
                aria-label={`Mark task complete: ${task.title}`}
              >
                <Square className="w-3.5 h-3.5" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{task.title}</div>
                {task.due_date && <div className="text-zinc-400">due {new Date(task.due_date).toLocaleDateString()}</div>}
              </div>
              <button
                type="button"
                onClick={() => deleteTask(task.id)}
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 touch-visible text-zinc-500 hover:text-red-400 focus-visible:text-red-400 shrink-0 mt-0.5 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400/50 rounded-sm"
                aria-label={`Delete task: ${task.title}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {completedTasks.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 mb-1"
            >
              {showCompleted ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Completed ({completedTasks.length})
            </button>
            {showCompleted && (
              <div className="space-y-1">
                {completedTasks.map((task) => (
                  <div key={task.id} className="group flex items-start gap-2 rounded bg-black/20 p-2 text-xs text-zinc-400">
                    <button
                      type="button"
                      onClick={() => toggleTaskStatus(task.id, task.status)}
                      className="text-green-500 hover:text-zinc-200 shrink-0 mt-0.5"
                      aria-label={`Mark task incomplete: ${task.title}`}
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium line-through">{task.title}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteTask(task.id)}
                      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 touch-visible text-zinc-500 hover:text-red-400 focus-visible:text-red-400 shrink-0 mt-0.5 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400/50 rounded-sm"
                      aria-label={`Delete task: ${task.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-white"><FileText className="w-4 h-4" /> Docs & Notes</div>
        <div className="flex gap-2 mb-2">
          <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="New note" className="flex-1 bg-black/30 rounded px-2 py-1 text-sm" />
          <Button size="sm" aria-label="Add note" onClick={async () => {
            if (!docTitle.trim()) return
            await fetch(`/api/channels/${channelId}/docs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: docTitle, content: "" }) })
            setDocTitle("")
            await load()
          }}><Plus className="w-3 h-3" /></Button>
        </div>
        <div className="space-y-1">
          {docs.map((doc) => (
            <div key={doc.id} className="group flex items-start gap-2 rounded bg-black/20 p-2 text-xs text-zinc-200">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{doc.title}</div>
                <div className="text-zinc-400">updated {new Date(doc.updated_at).toLocaleString()}</div>
              </div>
              <button
                type="button"
                onClick={() => deleteDoc(doc.id)}
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 touch-visible text-zinc-500 hover:text-red-400 focus-visible:text-red-400 shrink-0 mt-0.5 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400/50 rounded-sm"
                aria-label={`Delete doc: ${doc.title}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
