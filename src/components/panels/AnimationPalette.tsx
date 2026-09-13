import type { ReactNode } from 'react'
import { ArrowDownUp, ArrowLeftRight, ArrowRightLeft, ArrowUpDown, RedoDot, UndoDot } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import type { AnimationType, AnimationSpeed } from '@/engine/animation/types'
import { PENDULUM_AMOUNT_MAX, PENDULUM_AMOUNT_MIN, SLIDE_AMOUNT_MAX, SLIDE_AMOUNT_MIN, encodeSliceKey, isPendulumMode, isSlideMode } from '@/engine/animation/animationLayers'

const ANIM_TYPES: Array<{ id: AnimationType; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'rotate-cw', label: 'Rotate CW' },
  { id: 'rotate-ccw', label: 'Rotate CCW' },
  { id: 'slide-vertical', label: 'Translate Up-Down' },
  { id: 'slide-vertical-rev', label: 'Translate Down-Up' },
  { id: 'slide-horizontal', label: 'Translate Left-Right' },
  { id: 'slide-horizontal-rev', label: 'Translate Right-Left' },
  { id: 'pendulum', label: 'Pendulum' },
  { id: 'pendulum-rev', label: 'Pendulum Reverse' },
]

const SPEEDS: AnimationSpeed[] = [1, 2, 3]

export function AnimationPalette() {
  const plane = useAppStore((s) => s.plane)
  const animSettings = useAppStore((s) => s.animSettings)
  const handleSelectType = useAppStore((s) => s.setAnimationTypeForCurrentSlice)
  const handleSelectSpeed = useAppStore((s) => s.setAnimationSpeedForCurrentSlice)
  const handleSlideAmount = useAppStore((s) => s.setSlideAmountForCurrentSlice)
  const handleSwingAmount = useAppStore((s) => s.setSwingAmountForCurrentSlice)

  const sliceKey = encodeSliceKey(plane.axis, plane.offset)
  const currentSettings = animSettings.get(sliceKey) ?? null

  const activeType = currentSettings?.animationType ?? 'none'
  const activeSpeed = currentSettings?.speed ?? 1
  const activeSlideAmount = currentSettings?.slideAmount ?? 4
  const activeSwingAmount = currentSettings?.swingAmount ?? 30

  const showSlideSlider = isSlideMode(activeType)
  const showSwingSlider = isPendulumMode(activeType)

  return (
    <div
      className="flex flex-col items-center gap-2"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        {ANIM_TYPES.map(({ id, label }) => {
          const active = activeType === id
          let content: ReactNode
          switch (id) {
            case 'none': content = '\u00D7'; break
            case 'rotate-cw': content = '\u21BB'; break
            case 'rotate-ccw': content = '\u21BA'; break
            case 'slide-vertical': content = <ArrowUpDown size={14} />; break
            case 'slide-vertical-rev': content = <ArrowDownUp size={14} />; break
            case 'slide-horizontal': content = <ArrowLeftRight size={14} />; break
            case 'slide-horizontal-rev': content = <ArrowRightLeft size={14} />; break
            case 'pendulum': content = <UndoDot size={14} />; break
            case 'pendulum-rev': content = <RedoDot size={14} />; break
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
              {content}
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

        {showSlideSlider && (
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
        {showSwingSlider && (
          <>
            <span className="text-[10px] font-medium text-neutral-500">swing</span>
            <input
              type="range"
              min={PENDULUM_AMOUNT_MIN}
              max={PENDULUM_AMOUNT_MAX}
              value={activeSwingAmount}
              onChange={(e) => handleSwingAmount(Number(e.target.value))}
              className="h-4 w-16 accent-violet-500"
            />
            <span className="w-6 text-center text-[10px] tabular-nums text-neutral-400">{activeSwingAmount}°</span>
          </>
        )}
      </div>
    </div>
  )
}
