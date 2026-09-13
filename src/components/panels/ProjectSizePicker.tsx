import type { GridExtent } from '@/engine/grid/types'
import { CUSTOM_MAX, CUSTOM_MIN, SIZE_OPTIONS, parseCustomSize } from './projectSizeOptions'

/**
 * Shared project-size picker: the Small/Medium/Large presets plus a Custom field for any edge
 * length in [CUSTOM_MIN, CUSTOM_MAX], including odd sizes (which give a centered pillar). Used by
 * both the New Project dialog and the Project Settings dialog so the two stay visually identical.
 */
export function ProjectSizePicker({
  selected,
  customText,
  onSelect,
  onCustomTextChange,
  onCommit,
}: {
  selected: GridExtent | 'custom'
  customText: string
  onSelect: (s: GridExtent | 'custom') => void
  onCustomTextChange: (t: string) => void
  /** Called on Enter in the custom field (create/save). */
  onCommit: () => void
}) {
  const customExtent = parseCustomSize(customText)
  const isCustom = selected === 'custom'

  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-2 w-18 text-sm font-medium text-neutral-400 select-none">Size</span>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex gap-2">
          {SIZE_OPTIONS.map(({ extent, label }) => {
            const active = !isCustom && selected === extent
            return (
              <button
                key={extent}
                onClick={() => onSelect(extent)}
                className={
                  'flex-1 rounded-md px-3 py-2 text-center transition ' +
                  (active
                    ? 'bg-violet-500/20 text-violet-300'
                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200')
                }
              >
                <div className="text-sm font-medium">{label}</div>
                <div className="font-mono text-xs tabular-nums opacity-70">{extent}³</div>
              </button>
            )
          })}
          <button
            onClick={() => onSelect('custom')}
            className={
              'flex-1 rounded-md px-3 py-2 text-center transition ' +
              (isCustom
                ? 'bg-violet-500/20 text-violet-300'
                : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200')
            }
          >
            <div className="text-sm font-medium">Custom</div>
            <div className="font-mono text-xs tabular-nums opacity-70">
              {customExtent !== null ? `${customExtent}³` : '—'}
            </div>
          </button>
        </div>

        {isCustom && (
          <div className="flex items-center gap-2.5">
            <input
              type="number"
              min={CUSTOM_MIN}
              max={CUSTOM_MAX}
              value={customText}
              onChange={(e) => onCustomTextChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onCommit() }}
              placeholder="e.g. 9"
              autoFocus
              className="w-24 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5
                text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <span className="text-xs text-neutral-500">
              edge length, {CUSTOM_MIN}–{CUSTOM_MAX} (odd sizes get a centered pillar)
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
