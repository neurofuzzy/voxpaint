import { useCallback } from 'react'
import { useAppStore } from '@/store/useAppStore'
import type { AnimationType, AnimationSpeed } from '@/engine/animation/types'
import { SLIDE_AMOUNT_MAX, SLIDE_AMOUNT_MIN, defaultAnimationSettings, encodeSliceKey, isSlideMode } from '@/engine/animation/animationLayers'

const ANIM_TYPES: Array<{ id: AnimationType; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'rotate-cw', label: 'Rotate CW' },
  { id: 'rotate-ccw', label: 'Rotate CCW' },
  { id: 'slide-vertical', label: 'Slide Vert' },
  { id: 'slide-horizontal', label: 'Slide Horiz' },
]

const SPEEDS: AnimationSpeed[] = [1, 2, 3]

export function AnimationPalette() {
  const plane = useAppStore((s) => s.plane)
  const animSettings = useAppStore((s) => s.animSettings)
  const setAnimSettingsForSlice = useAppStore((s) => s.setAnimSettingsForSlice)

  const sliceKey = encodeSliceKey(plane.axis, plane.offset)
  const currentSettings = animSettings.get(sliceKey) ?? null

  const activeType = currentSettings?.animationType ?? 'none'
  const activeSpeed = currentSettings?.speed ?? 1
  const activeSlideAmount = currentSettings?.slideAmount ?? 4

  const handleSelectType = useCallback((type: AnimationType) => {
    const { axis, offset } = useAppStore.getState().plane
    if (type === 'none') {
      setAnimSettingsForSlice(axis, offset, null)
    } else {
      const key = encodeSliceKey(axis, offset)
      const prev = useAppStore.getState().animSettings.get(key) ?? defaultAnimationSettings()
      setAnimSettingsForSlice(axis, offset, {
        animationType: type,
        speed: prev.speed,
        slideAmount: prev.slideAmount,
      })
    }
  }, [setAnimSettingsForSlice])

  const handleSelectSpeed = useCallback((speed: AnimationSpeed) => {
    const { axis, offset } = useAppStore.getState().plane
    const key = encodeSliceKey(axis, offset)
    const prev = useAppStore.getState().animSettings.get(key) ?? defaultAnimationSettings()
    setAnimSettingsForSlice(axis, offset, { ...prev, speed })
  }, [setAnimSettingsForSlice])

  const handleSlideAmount = useCallback((v: number) => {
    const { axis, offset } = useAppStore.getState().plane
    const key = encodeSliceKey(axis, offset)
    const prev = useAppStore.getState().animSettings.get(key) ?? defaultAnimationSettings()
    setAnimSettingsForSlice(axis, offset, { ...prev, slideAmount: v })
  }, [setAnimSettingsForSlice])

  const showSlider = isSlideMode(activeType)

  return (
    <div
      className="flex flex-col items-center gap-2"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        {ANIM_TYPES.map(({ id, label }) => {
          const active = activeType === id
          let symbol: string
          switch (id) {
            case 'none': symbol = '\u00D7'; break
            case 'rotate-cw': symbol = '\u21BB'; break
            case 'rotate-ccw': symbol = '\u21BA'; break
            case 'slide-vertical': symbol = '\u2195'; break
            case 'slide-horizontal': symbol = '\u2194'; break
          }
          return (
            <button
              key={id}
              aria-label={label}
              title={label}
              onClick={() => handleSelectType(id)}
              className={
                'flex h-7 items-center justify-center rounded-full px-2.5 text-sm font-medium transition ' +
                (active
                  ? 'bg-violet-500/60 text-white shadow'
                  : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200')
              }
            >
              {symbol}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium text-neutral-500">speed</span>
        <div className="flex rounded-md border border-neutral-700 overflow-hidden">
          {SPEEDS.map((s) => {
            const active = activeSpeed === s
            return (
              <button
                key={s}
                onClick={() => handleSelectSpeed(s)}
                className={
                  'px-2 py-0.5 text-xs font-medium transition ' +
                  (active
                    ? 'bg-violet-500/60 text-white'
                    : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200')
                }
              >
                {s}x
              </button>
            )
          })}
        </div>

        {showSlider && (
          <>
            <span className="text-[10px] font-medium text-neutral-500">slide</span>
            <input
              type="range"
              min={SLIDE_AMOUNT_MIN}
              max={SLIDE_AMOUNT_MAX}
              value={activeSlideAmount}
              onChange={(e) => handleSlideAmount(Number(e.target.value))}
              className="h-4 w-16 accent-violet-500"
            />
            <span className="w-4 text-center text-[10px] tabular-nums text-neutral-400">{activeSlideAmount}</span>
          </>
        )}
      </div>
    </div>
  )
}
