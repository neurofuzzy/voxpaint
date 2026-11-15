import { useEffect, useRef, useState } from 'react'
import { Pause, Play, Plus } from 'lucide-react'
import { normalizeFps, snapClipTime } from '@/engine/rigging/types'
import { sampleKeyPayload } from '@/engine/rigging/clip'
import type { RigClip } from '@/engine/rigging/types'
import { clampKeyTime } from '@/store/poseSlice'
import { useAppStore } from '@/store/useAppStore'

/** Hover text across the whole dock while the Rig tab has it disabled. */
const LOCKED_HINT = 'Select the Motion tab to edit or scrub the timeline'

/**
 * Bottom-docked character-animation timeline (Flash-style), pinned under the 2D/3D
 * views (right of the side panels) whenever Animate mode is in poses mode. Owns
 * transport, the frame ruler, the keyframe lane, and the frame readout — and keys to
 * whatever animation the side panel has selected.
 * The side panel keeps only the keyframe inspector card — time lives here.
 *
 * Forgiving by design: click any frame to scrub it, double-click empty track to key
 * there (mid-tween that freezes the blended pose, so the animation survives the
 * insert; otherwise it copies the selected — else nearest — key instead of refusing),
 * drag diamonds to retime, click a diamond (or its frame) to select it. The dock stays
 * mounted on the Rig tab too, but visibly disabled there — the Motion tab owns it.
 */
export function TimelineDock() {
  const clips = useAppStore((s) => s.clips)
  const activeClipId = useAppStore((s) => s.activeClipId)
  const animateTab = useAppStore((s) => s.animateTab)
  const clipPlaying = useAppStore((s) => s.clipPlaying)
  const clipTime = useAppStore((s) => s.clipTime)
  const rigBoxCount = useAppStore((s) => s.rigBoxes.length)
  const setClipPlaying = useAppStore((s) => s.setClipPlaying)

  const clip = clips.find((c) => c.id === activeClipId) ?? null
  // The Motion tab owns the timeline: on Rig it renders dimmed and inert, with the
  // hint as its hover text (every control below honors `locked` too, so the hover text
  // always reads the same way wherever the pointer lands).
  const locked = animateTab !== 'poses'
  const lockedHint = LOCKED_HINT

  const lastKeyTime = clip && clip.keys.length > 0 ? clip.keys[clip.keys.length - 1].time : 0
  const keyAt = clipTime ?? (clip && clip.keys.length > 0 ? lastKeyTime + 0.5 : 0)

  /** Forgiving key insert (Flash F6): mid-tween it freezes the blended pose at that
   * frame into the new key, so the frame — and the animation around it — survive the
   * insert (linear/hold spans reproduce exactly, eased spans inherit the segment's
   * ease); onto a key or outside the key range it copies the selected — else nearest
   * — key and retimes the copy onto `t`, like before. Clips always carry their
   * frame-1 anchor, so there is always something to copy (the empty branch is a
   * just-in-case bind key). */
  function insertKeyAt(t: number) {
    if (!clip || locked) return
    const st = useAppStore.getState()
    if (clip.keys.length === 0) {
      st.addKeyframe(clip.id, t)
      return
    }
    const fps = normalizeFps(st.meta.fps)
    const at = snapClipTime(t, fps)
    const sorted = [...clip.keys].sort((a, b) => a.time - b.time)
    const onKey = sorted.some((k) => Math.abs(k.time - at) < 1e-9)
    const prev = [...sorted].reverse().find((k) => k.time < at - 1e-9) ?? null
    const next = sorted.find((k) => k.time > at + 1e-9) ?? null
    if (!onKey && prev && next) {
      const { joints, offsets } = sampleKeyPayload(st.rigBoxes, clip, at)
      st.animBeginStroke()
      st.addKeyframe(clip.id, at, { joints, offsets, ease: prev.ease })
      st.animCommitStroke()
      return
    }
    const src =
      clip.keys.find((k) => k.id === st.selectedKeyId) ??
      clip.keys.reduce((a, b) => (Math.abs(b.time - t) < Math.abs(a.time - t) ? b : a))
    st.animBeginStroke()
    const dupe = st.duplicateKey(clip.id, src.id)
    if (dupe) st.patchKey(clip.id, dupe, { time: t })
    st.animCommitStroke()
  }

  return (
    <div
      className={'shrink-0 border-t border-neutral-800 bg-neutral-900 px-3 py-2' + (locked ? ' opacity-60' : '')}
      title={locked ? lockedHint : undefined}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setClipPlaying(!clipPlaying)}
          disabled={!clip || locked}
          title={locked ? lockedHint : (!clip ? 'Pick an animation in the side panel first' : clipPlaying ? 'Pause (freezes the playhead where it stops)' : 'Play the animation')}
          className="flex h-6 w-6 items-center justify-center rounded bg-violet-500/20 text-violet-200 hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {clipPlaying ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 select-none">Timeline</span>
        {clip ? (
          <>
            <span
              className="min-w-0 flex-1 truncate text-[11px] font-medium text-neutral-200"
              title={`Editing "${clip.name}" — manage animations in the side panel's Animations list`}
            >
              {clip.name}
            </span>
            <button
              onClick={() => insertKeyAt(keyAt)}
              disabled={locked}
              title={locked ? lockedHint : `Freeze the playhead frame into a new keyframe at ${keyAt.toFixed(2)}s (mid-tween this keeps the blended pose)`}
              className="flex items-center gap-1 rounded bg-violet-500/20 px-2 py-1 text-[11px] font-medium text-violet-200 hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-violet-500/20"
            >
              <Plus size={12} />
              keyframe
            </button>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">
            No animation selected — pick one in the side panel's Animations list.
          </span>
        )}
      </div>
      {rigBoxCount === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-800 px-2 py-2 text-center text-[11px] text-neutral-500">
          No rig boxes yet — head to the <span className="font-medium text-neutral-300">Rig tab</span>, box a region, then come back to key it here.
        </p>
      ) : clip ? (
        <TimelinePanel clip={clip} locked={locked} onInsertKey={insertKeyAt} />
      ) : (
        <p className="rounded-md border border-dashed border-neutral-800 px-2 py-2 text-center text-[11px] text-neutral-500">
          Each animation is one action — walk, idle, dodge. Press <span className="font-medium text-violet-300">New animation</span> in the side panel's Animations list to start.
        </p>
      )}
    </div>
  )
}

/**
 * Flash-style timeline: a frame-numbered ruler on top, one keyframe lane below, and a
 * red playhead spanning both — every frame is a fixed-width grid cell (long clips
 * scroll instead of shrinking). Click/drag frames to scrub; double-click an empty
 * frame to key it (forgiving: it copies the selected — else nearest — key, Flash-F6
 * style, instead of refusing); drag a diamond to retime (one undo entry, first key
 * locked at frame 1); click a diamond — or the frame it sits on — to select that
 * single frame. Tween spans shade per cell: violet for eased segments, amber for
 * Hold, plus the loop wrap.
 */
function TimelinePanel({ clip, locked, onInsertKey }: { clip: RigClip; locked: boolean; onInsertKey: (t: number) => void }) {
  const clipTime = useAppStore((s) => s.clipTime)
  const clipPlaying = useAppStore((s) => s.clipPlaying)
  const clipStartedAt = useAppStore((s) => s.clipStartedAt)
  const selectedKeyId = useAppStore((s) => s.selectedKeyId)
  const fps = useAppStore((s) => normalizeFps(s.meta.fps))
  const setClipPlaying = useAppStore((s) => s.setClipPlaying)
  const setClipTime = useAppStore((s) => s.setClipTime)
  const setSelectedKey = useAppStore((s) => s.setSelectedKey)
  const patchKey = useAppStore((s) => s.patchKey)
  const animBeginStroke = useAppStore((s) => s.animBeginStroke)
  const animCommitStroke = useAppStore((s) => s.animCommitStroke)
  const trackRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Live playhead: while the transport runs, tick every animation frame so the
  // current frame, grid highlight, and scrubber all advance with playback.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!clipPlaying) return
    let raf = 0
    const loop = () => {
      setTick((t) => t + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [clipPlaying])
  // Scrub gesture vs key-retime gesture (keys stop-propagation, so only one runs).
  // Retime listens on the window, not the diamond: the diamond unmounts into a new
  // cell as it crosses frame boundaries mid-drag, which would drop a per-element
  // listener and strand the key wherever a fast drag let go.
  const scrubbing = useRef(false)
  // The retime drag clamps against the duration captured at pointer-down, so pushing a
  // key past the end can never grow the clip mid-drag and rescale the track under it.
  const retime = useRef<{ keyId: string; startX: number; startTime: number; moved: boolean; duration: number; loop: boolean; finish: () => void } | null>(null)
  // A drag orphaned by unmount (never in practice — the dock is always mounted) must
  // still commit its open undo bracket instead of leaking it into the next gesture.
  useEffect(() => () => {
    const drag = retime.current
    retime.current = null
    drag?.finish()
  }, [])
  // Double-click to key: last background tap (time + position) — a second quick tap in
  // place inserts a keyframe instead of just scrubbing.
  const lastTap = useRef<{ at: number; x: number } | null>(null)
  const downPos = useRef<{ x: number; y: number } | null>(null)

  const selectedKey = clip.keys.find((k) => k.id === selectedKeyId) ?? null
  // While the transport runs, the playhead is the live clock (loop wraps, one-shot
  // holds the end); paused or scrubbed, it's the frozen playhead, else the selection.
  const transportTime = clipPlaying ? performance.now() / 1000 - clipStartedAt : null
  const liveTime = transportTime === null
    ? null
    : clip.loop
      ? ((transportTime % clip.duration) + clip.duration) % clip.duration
      : Math.min(transportTime, clip.duration)
  const playhead = liveTime ?? clipTime ?? selectedKey?.time ?? null

  // Discrete frame grid (voxel-style Flash) at the project frame rate: one fixed-width
  // cell per frame so cells stay hittable — long clips scroll instead of shrinking.
  const totalFrames = Math.max(1, Math.round(clip.duration * fps))
  const cellPx = totalFrames <= 240 ? 18 : Math.max(10, Math.round(4320 / totalFrames))
  const curFrame = playhead === null ? null : Math.min(totalFrames - 1, Math.floor(playhead * fps))
  // Centered in the highlighted cell: the scrubber marks the current *frame*, never a
  // fractional offset into the next cell while the live clock sweeps between frames.
  const playX = curFrame === null ? 0 : curFrame * cellPx + cellPx / 2
  const keyFrameOf = new Map<number, (typeof clip.keys)[number]>()
  for (const k of clip.keys) keyFrameOf.set(Math.min(totalFrames - 1, Math.round(k.time * fps)), k)
  const sortedKeys = [...clip.keys].sort((a, b) => a.time - b.time)
  /** Shade class for a frame cell: tween span (solid eased / amber hold), loop wrap, else plain. */
  function cellShade(f: number): string {
    if (keyFrameOf.has(f)) return ''
    if (clip.loop) {
      const last = sortedKeys[sortedKeys.length - 1]
      if (last && f / fps >= last.time - 1e-9) return 'bg-violet-500/10'
    }
    for (let i = 0; i < sortedKeys.length - 1; i++) {
      const a = sortedKeys[i]
      const b = sortedKeys[i + 1]
      if (f / fps >= a.time - 1e-9 && f / fps < b.time - 1e-9) {
        return a.ease === 'hold' ? 'bg-amber-400/10' : 'bg-violet-500/15'
      }
    }
    return ''
  }

  // Keep the live playhead in view while playing (never fight a manual scrub).
  useEffect(() => {
    if (!clipPlaying || curFrame === null) return
    const el = scrollRef.current
    if (!el) return
    const x = curFrame * cellPx + cellPx / 2
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: Math.max(0, x - el.clientWidth / 2), behavior: 'auto' })
    }
  }, [clipPlaying, curFrame, cellPx])

  function timeAt(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    const t = (clientX - rect.left) / rect.width
    return Math.min(Math.max(t, 0), 1) * clip.duration
  }

  /** Frame cell under the pointer (floor, not round: the cell you touch is the cell you get). */
  function frameAt(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    const f = Math.floor(((clientX - rect.left) / rect.width) * totalFrames)
    return Math.min(Math.max(f, 0), totalFrames - 1)
  }

  /** Tap (no drag) selects a single frame — and the keyframe on it, if any. */
  function selectFrameAt(t: number) {
    // Floor-quantized like the grid itself: tapping the right half of a cell must not
    // round half-up into the next frame.
    const frame = Math.min(totalFrames - 1, Math.max(0, Math.floor(t * fps)))
    const snapped = frame / fps
    const hit = clip.keys.find((k) => k.id !== selectedKey?.id && Math.abs(k.time - snapped) < 1e-9)
      ?? clip.keys.find((k) => Math.abs(k.time - snapped) < 1e-9)
    if (hit) setSelectedKey(hit.id)
  }

  function onBackgroundDown(e: React.PointerEvent) {
    if (locked) return
    if (clipPlaying) setClipPlaying(false)
    scrubbing.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    // Land on the tapped cell itself (drag moves stay smooth via timeAt).
    setClipTime(frameAt(e.clientX) / fps)
  }

  function onBackgroundUp(e: React.PointerEvent) {
    scrubbing.current = false
    if (locked) return
    // Unmoved quick tap: first tap selects the frame; a second one in place keys there.
    if (Math.hypot(e.clientX - (downPos.current?.x ?? e.clientX), e.clientY - (downPos.current?.y ?? e.clientY)) > 6) return
    const t = frameAt(e.clientX) / fps
    selectFrameAt(t)
    const now = performance.now()
    const prev = lastTap.current
    lastTap.current = { at: now, x: e.clientX }
    if (prev && now - prev.at < 350 && Math.abs(e.clientX - prev.x) < 8) {
      lastTap.current = null
      onInsertKey(t)
    }
  }

  const rulerHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      downPos.current = { x: e.clientX, y: e.clientY }
      onBackgroundDown(e)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!locked && scrubbing.current) setClipTime(timeAt(e.clientX))
    },
    onPointerUp: (e: React.PointerEvent) => {
      onBackgroundUp(e)
      downPos.current = null
    },
    onPointerCancel: () => { scrubbing.current = false; downPos.current = null },
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Frame grid: one fixed-width cell per frame — scrolls instead of shrinking. */}
      <div ref={scrollRef} className="overflow-x-auto touch-none rounded bg-neutral-800/60">
        <div ref={trackRef} className="relative select-none" style={{ width: totalFrames * cellPx }}>
          {/* Ruler: numbered frame cells — click/drag scrubs. */}
          <div
            className={'grid h-6 border-b border-neutral-700/60' + (locked ? ' cursor-not-allowed' : ' cursor-pointer')}
            style={{ gridTemplateColumns: `repeat(${totalFrames}, ${cellPx}px)` }}
            title={locked ? LOCKED_HINT : 'Frame ruler — drag to scrub the playhead'}
            {...rulerHandlers}
          >
            {Array.from({ length: totalFrames }, (_, f) => (
              <div
                key={f}
                className={
                  'relative border-r border-neutral-700/40 font-mono text-[9px] leading-none text-neutral-500 ' +
                  (f % fps === 0 ? 'border-l border-l-neutral-500' : '')
                }
              >
                {(f + 1) % 10 === 0 && (
                  <span className="pointer-events-none absolute left-0.5 top-1">{f + 1}</span>
                )}
              </div>
            ))}
          </div>
          {/* Lane: one cell per frame — click selects it, double-click empties key it. */}
          <div
            className={'grid h-12' + (locked ? ' cursor-not-allowed' : ' cursor-pointer')}
            style={{ gridTemplateColumns: `repeat(${totalFrames}, ${cellPx}px)` }}
            title={locked ? LOCKED_HINT : 'Click a frame to select it · double-click an empty frame to key here (freezes the blended pose) · drag a key to retime'}
            {...rulerHandlers}
          >
            {Array.from({ length: totalFrames }, (_, f) => {
              const key = keyFrameOf.get(f)
              const isPlay = curFrame === f
              const sortedIndex = key ? sortedKeys.findIndex((k) => k.id === key.id) : -1
              const anchor = sortedIndex === 0
              const selected = key ? key.id === selectedKeyId : false
              const hold = key ? key.ease === 'hold' : false
              return (
                <div
                  key={f}
                  className={
                    'relative flex items-center justify-center border-r border-neutral-800/80 ' +
                    cellShade(f) +
                    (isPlay ? ' bg-white/10' : '')
                  }
                >
                  {key && (
                    <button
                      aria-label={`Keyframe ${key.name} at frame ${f + 1}`}
                      disabled={locked}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        if (clipPlaying) setClipPlaying(false)
                        // The frame-1 anchor never drags: a press selects it and seeks the
                        // playhead there, so the keyframe card edits the frame on screen.
                        if (anchor) {
                          setSelectedKey(key.id)
                          setClipTime(key.time)
                          return
                        }
                        // Bracketed once per press so the whole retime drag lands in one
                        // undo entry. Window listeners (not the diamond) drive the drag —
                        // see the retime ref comment.
                        animBeginStroke()
                        const drag = { keyId: key.id, startX: e.clientX, startTime: key.time, moved: false, duration: clip.duration, loop: clip.loop, finish: () => {} }
                        const onMove = (ev: PointerEvent) => {
                          if (Math.abs(ev.clientX - drag.startX) > 3) drag.moved = true
                          if (!drag.moved) return
                          const rect = trackRef.current?.getBoundingClientRect()
                          if (!rect || rect.width === 0) return
                          const raw = drag.startTime + ((ev.clientX - drag.startX) / rect.width) * clip.duration
                          patchKey(clip.id, key.id, { time: clampKeyTime(raw, drag.duration, drag.loop, fps) })
                        }
                        const endDrag = (select: boolean) => {
                          window.removeEventListener('pointermove', onMove)
                          window.removeEventListener('pointerup', onUp)
                          window.removeEventListener('pointercancel', onCancel)
                          if (retime.current === drag) retime.current = null
                          animCommitStroke()
                          // A click (no drag) selects the key and seeks the playhead
                          // there, so the keyframe card edits the frame on screen.
                          if (select) {
                            setSelectedKey(key.id)
                            setClipTime(key.time)
                          }
                        }
                        const onUp = () => endDrag(!drag.moved)
                        const onCancel = () => endDrag(false)
                        drag.finish = () => endDrag(false)
                        window.addEventListener('pointermove', onMove)
                        window.addEventListener('pointerup', onUp)
                        window.addEventListener('pointercancel', onCancel)
                        retime.current = drag
                      }}
                      title={
                        locked
                          ? LOCKED_HINT
                          : (anchor ? `First key "${key.name}" — locked at frame 1 (click to select)` : `Key "${key.name}" at frame ${f + 1} · ${key.ease} — drag to retime, click to select`) +
                            (hold ? ' · Hold: freezes until the next key' : '')
                      }
                      className={
                        'flex h-7 w-7 items-center justify-center ' +
                        (locked ? 'cursor-not-allowed' : anchor ? 'cursor-pointer' : 'cursor-ew-resize')
                      }
                    >
                      <span
                        className={
                          'block h-3.5 w-3.5 rotate-45 rounded-[2px] border ' +
                          (selected
                            ? 'border-white bg-violet-300'
                            : hold
                              ? 'border-amber-300/80 bg-amber-400/70 hover:bg-amber-300'
                              : 'border-neutral-900 bg-neutral-400 hover:bg-neutral-200')
                        }
                      />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {/* Red playhead spanning ruler + lane. */}
          {playhead !== null && (
            <>
              <div
                className="pointer-events-none absolute -top-0.5 h-4 w-3 -translate-x-1/2 rounded-sm bg-amber-500"
                style={{ left: `${playX}px` }}
              />
              <div
                className="pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-amber-500/90"
                style={{ left: `${playX}px` }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
