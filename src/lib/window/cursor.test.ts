import { describe, expect, it } from 'vitest'
import { resolveCssCursor, resolveCursorIcon, resolveCursorState } from './cursor'

describe('cursor helpers', () => {
  it('maps image state to cursor state and cursor icon', () => {
    expect(
      resolveCursorState({
        imageLoaded: false,
        mode: 'transform',
        dragging: false,
      }),
    ).toBe('default')
    expect(
      resolveCursorState({
        imageLoaded: true,
        mode: 'transform',
        dragging: false,
      }),
    ).toBe('transform')
    expect(
      resolveCursorState({
        imageLoaded: true,
        mode: 'transform',
        dragging: true,
      }),
    ).toBe('dragging')
    expect(
      resolveCursorState({
        imageLoaded: true,
        mode: 'select-anchor',
        dragging: false,
      }),
    ).toBe('select-anchor')
    expect(resolveCursorIcon('transform')).toBe('grab')
    expect(resolveCursorIcon('dragging')).toBe('grabbing')
    expect(resolveCursorIcon('select-anchor')).toBe('crosshair')
    expect(resolveCssCursor('grab')).toBe('grab')
  })
})
