import { makeEditTool } from './editToolFactory'

export const paintTool = makeEditTool(
  (ctx, u, v) => {
    ctx.paintCell(u, v)
  },
  {
    beginStroke: (ctx) => ctx.beginStroke(),
    commitStroke: (ctx) => ctx.commitStroke(),
    // Bevels painted earlier in a drag classified against incomplete neighbors — re-resolve
    // them against the finished stroke on release, so a series of bevels lands correctly
    // without painting over the same spots again.
    correctStroke: (ctx) => ctx.correctChamferStroke(),
  },
)
