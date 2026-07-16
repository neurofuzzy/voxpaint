import { useEffect, useRef, useState } from 'react'
import logoUrl from '@/assets/logo.svg'
import { FileMenu } from '@/components/panels/FileMenu'
import { FullscreenToggle } from '@/components/panels/FullscreenToggle'
import { ModeTabs } from '@/components/panels/ModeTabs'
import { ModelStats } from '@/components/panels/ModelStats'
import { HelpButton } from '@/components/onboarding/HelpButton'
import { useAppStore } from '@/store/useAppStore'

function ProjectName() {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const name = useAppStore((s) => s.meta.name)

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [editing])

  function startEdit() {
    setDraft(name)
    setEditing(true)
  }

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== name) {
      useAppStore.getState().setProjectName(trimmed)
    }
    setEditing(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className="h-6 w-44 rounded border border-neutral-600 bg-neutral-800 px-1.5
          text-sm text-neutral-200 outline-none focus:border-violet-500"
      />
    )
  }

  return (
    <button
      onClick={startEdit}
      className="max-w-48 truncate rounded px-1.5 py-0.5 text-sm text-blue-400 hover:bg-neutral-800 hover:text-blue-300"
      title="Click to rename project"
    >
      {name}
    </button>
  )
}

export function TopToolbar() {
  return (
    <div className="flex h-11 items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-2">
      <img src={logoUrl} alt="VoxPaint" className="h-5 w-auto" />
      <FileMenu />
      <ModeTabs />
      <ProjectName />
      <div className="flex-1" />
      <ModelStats />
      <div className="h-5 w-px bg-neutral-800" />
      <HelpButton />
      <FullscreenToggle />
    </div>
  )
}
