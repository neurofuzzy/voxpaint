import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Palette } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { DEFAULT_PALETTE } from '@/engine/palette/defaultPalette'
import { PALETTE_THEMES, type PaletteTheme } from '@/engine/palette/themes'
import { showToast } from '@/components/ui/toastBus'

const DEFAULT_THEME: PaletteTheme = { id: 'default', name: 'Default', palette: DEFAULT_PALETTE }
const THEMES: PaletteTheme[] = [DEFAULT_THEME, ...PALETTE_THEMES]

/** Small live preview strip — the theme's first 8 base swatches — so a theme is recognizable
 * without having to apply it first. */
function SwatchStrip({ hexes }: { hexes: string[] }) {
  return (
    <div className="flex h-4 shrink-0 overflow-hidden rounded-sm">
      {hexes.map((hex, i) => (
        <div key={i} className="w-3" style={{ backgroundColor: hex }} />
      ))}
    </div>
  )
}

/**
 * Theme chooser: applies a pre-made palette's colors (base/emissive/metal/glass) to the current
 * project via `applyPaletteTheme` — swaps every painted cell's rendered color at once, since cells
 * store `{kind, index}` slot references rather than resolved hex (see `engine/palette/palette.ts`'s
 * `resolveSlotColor`). "Default" is the app's own hand-tuned palette
 * (`engine/palette/defaultPalette.ts`); the rest come from `engine/palette/themes.ts`, generated
 * from `etc/colors/` by `scripts/generate-palette-themes.ts`.
 */
export function PaletteThemeMenu() {
  const applyPaletteTheme = useAppStore((s) => s.applyPaletteTheme)
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label="Color theme"
          title="Color theme"
          onPointerEnter={() => setStatusMessage('Choose a color theme for this project')}
          onPointerLeave={() => setStatusMessage(null)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100"
        >
          <Palette size={18} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-50 max-h-96 min-w-56 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900 p-1 text-sm text-neutral-200 shadow-xl"
        >
          {THEMES.map((theme) => (
            <DropdownMenu.Item
              key={theme.id}
              onSelect={() => {
                applyPaletteTheme(theme.palette)
                showToast(`Applied "${theme.name}" palette.`)
              }}
              className="flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 outline-none hover:bg-neutral-800"
            >
              <span>{theme.name}</span>
              <SwatchStrip hexes={theme.palette.base.slice(0, 8)} />
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
