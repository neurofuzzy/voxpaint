import { describe, expect, it } from 'vitest'
import type { RigBox } from './types'
import { moveRigBoxInList, rigIdForCoord, rigSubtreeIds } from './types'

const box = (id: string, parentId: string | null = null): RigBox => ({
  id,
  name: id,
  min: [0, 0, 0],
  max: [1, 1, 1],
  parentId,
})

describe('rigSubtreeIds', () => {
  it('collects the whole subtree inclusive', () => {
    const boxes = [box('a'), box('b', 'a'), box('c', 'a'), box('d', 'b')]
    expect([...rigSubtreeIds(boxes, 'a')].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect([...rigSubtreeIds(boxes, 'b')].sort()).toEqual(['b', 'd'])
    expect([...rigSubtreeIds(boxes, 'c')]).toEqual(['c'])
  })
})

describe('rigIdForCoord', () => {
  const parent: RigBox = { id: 'p', name: 'p', min: [0, 0, 0], max: [3, 3, 3], parentId: null }
  const child: RigBox = { id: 'c', name: 'c', min: [1, 1, 1], max: [2, 2, 2], parentId: 'p' }

  it('prefers the deepest containing box over list order', () => {
    // Parent first in list — the nested child still wins inside its bounds.
    expect(rigIdForCoord([parent, child], [1, 1, 1])).toBe('c')
    expect(rigIdForCoord([child, parent], [1, 1, 1])).toBe('c')
    expect(rigIdForCoord([parent, child], [0, 0, 0])).toBe('p')
  })

  it('returns null outside every box', () => {
    expect(rigIdForCoord([parent, child], [9, 9, 9])).toBeNull()
    expect(rigIdForCoord([], [0, 0, 0])).toBeNull()
  })
})

describe('moveRigBoxInList', () => {
  it('nests as last child of the target', () => {
    const next = moveRigBoxInList([box('a'), box('b'), box('c')], 'c', 'a', 'child')
    expect(next?.map((b) => [b.id, b.parentId])).toEqual([
      ['a', null],
      ['c', 'a'],
      ['b', null],
    ])
  })

  it('lands beside the target subtree, never splitting it', () => {
    // b has child d; moving e after b must land after d, not between b and d.
    const boxes = [box('a'), box('b'), box('d', 'b'), box('e')]
    const next = moveRigBoxInList(boxes, 'e', 'b', 'after')
    expect(next?.map((b) => b.id)).toEqual(['a', 'b', 'd', 'e'])
    expect(next?.find((b) => b.id === 'e')?.parentId).toBeNull()
  })

  it('adopts the target parent on before/after', () => {
    const boxes = [box('a'), box('b', 'a'), box('c')]
    const next = moveRigBoxInList(boxes, 'c', 'b', 'before')
    expect(next?.map((b) => [b.id, b.parentId])).toEqual([
      ['a', null],
      ['c', 'a'],
      ['b', 'a'],
    ])
  })

  it('appends at root level for a null target', () => {
    const boxes = [box('a'), box('b', 'a')]
    const next = moveRigBoxInList(boxes, 'b', null, 'after')
    expect(next?.map((b) => [b.id, b.parentId])).toEqual([
      ['a', null],
      ['b', null],
    ])
  })

  it('rejects drops into the dragged subtree, self-drops, and unknown ids', () => {
    const boxes = [box('a'), box('b', 'a')]
    expect(moveRigBoxInList(boxes, 'a', 'b', 'child')).toBeNull()
    expect(moveRigBoxInList(boxes, 'a', 'a', 'child')).toBeNull()
    expect(moveRigBoxInList(boxes, 'zzz', 'a', 'child')).toBeNull()
    expect(moveRigBoxInList(boxes, 'a', 'zzz', 'child')).toBeNull()
  })
})
