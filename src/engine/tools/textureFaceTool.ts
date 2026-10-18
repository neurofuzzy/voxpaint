import { makeEditTool } from './editToolFactory'
import type { ToolHandler } from './types'

/**
 * Texture-face paint: re-authors a ramp, wedge, or thin slab onto the active construction
 * plane's basis, reproducing its exact world-space solid (same geometry, same color — a wedge
 * source converts to its congruent ramp, a thin slab only flips orientation on its own axis)
 * so its box-mapped texture face follows the new basis. Existing voxels only — never adds or
 * deletes cells, never touches color, never alters geometry. Drag-supported (re-authoring is
 * idempotent once a cell sits on the active basis, so crossing cells can't pile anything up);
 * the store action returns false on no-ops so empty drags don't record junk undo steps. Silent
 * no-op on anything that isn't a resolved ramp/wedge/thin or whose solid the active plane
 * can't express (wedges never match their own basis — same-basis wedge→ramp congruence is
 * impossible; thins never turn across axes). Plain cubes sample texture by face normal and are
 * skipped.
 */
export const textureFaceTool: ToolHandler = makeEditTool((ctx, u, v) => {
  ctx.rebaseRampCell(u, v)
})
