/**
 * True when running on an iPad. iPadOS 13+ reports itself as desktop macOS (`Macintosh` /
 * `MacIntel`), so the user agent alone isn't enough — a Mac with a touchscreen is the tell.
 *
 * Used to work around an upstream Radix bug (radix-ui/primitives#1027, still open as #3052):
 * modal overlays (`DropdownMenu`/`Dialog` with `modal`, the default) never dispatch `click` for
 * Apple Pencil taps — `pointerdown`/`pointerup` fire, the tap is swallowed, and menu items and
 * dialog buttons silently do nothing. Non-modal roots work with finger, pencil, and mouse alike,
 * so iPad renders them non-modal while every other platform keeps the default modal behavior
 * (focus trap, scroll lock, background pointer lock).
 */
export function isIPad(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/iPad/.test(navigator.userAgent)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}
