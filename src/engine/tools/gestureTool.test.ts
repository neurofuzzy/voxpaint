import { describe, expect, it } from 'vitest'
import { resolveGestureTool } from './index'

describe('resolveGestureTool', () => {
  it('springs rigbox to pivot on Alt in Animate mode (focus-independent switch)', () => {
    expect(resolveGestureTool('animate', 'rigbox', true)).toBe('pivot')
  })

  it('springs the pose tool to pivot too', () => {
    expect(resolveGestureTool('animate', 'pose', true)).toBe('pivot')
    expect(resolveGestureTool('animate', 'pose', false)).toBe('pose')
  })

  it('is the identity without Alt', () => {
    expect(resolveGestureTool('animate', 'rigbox', false)).toBe('rigbox')
    expect(resolveGestureTool('animate', 'pivot', false)).toBe('pivot')
  })

  it('leaves the real pivot tool alone (Alt+click still pins via pivotTool itself)', () => {
    expect(resolveGestureTool('animate', 'pivot', true)).toBe('pivot')
  })

  it('never springs outside Animate mode', () => {
    expect(resolveGestureTool('model', 'rigbox', true)).toBe('rigbox')
    expect(resolveGestureTool('texture', 'paint', true)).toBe('paint')
    expect(resolveGestureTool('model', 'paint', true)).toBe('paint')
  })
})
