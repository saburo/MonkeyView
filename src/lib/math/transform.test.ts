import { describe, expect, it } from 'vitest'
import {
  MIN_UNIFORM_SCALE,
  createTransformDragSession,
  normalizeRotationDeg,
  projectTransformDrag,
} from './transform'

describe('transform math', () => {
  it('rejects drag starts too close to the anchor', () => {
    const session = createTransformDragSession({ x: 0, y: 0 }, { x: 2, y: 3 }, 1, 0)
    expect(session).toBeNull()
  })

  it('computes uniform scale and clockwise rotation from drag movement', () => {
    const session = createTransformDragSession({ x: 0, y: 0 }, { x: 10, y: 0 }, 2, 15)
    expect(session).not.toBeNull()

    const projection = projectTransformDrag(session!, { x: 0, y: 20 })
    expect(projection.uniformScale).toBeCloseTo(4)
    expect(normalizeRotationDeg(projection.rotationDeg)).toBeCloseTo(105)
  })

  it('clamps scale to the minimum supported factor', () => {
    const session = createTransformDragSession({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, 0)
    const projection = projectTransformDrag(session!, { x: 0.001, y: 0 })
    expect(projection.uniformScale).toBe(MIN_UNIFORM_SCALE)
  })

  it('normalizes clockwise rotation into a 0..360 range', () => {
    expect(normalizeRotationDeg(-90)).toBe(270)
    expect(normalizeRotationDeg(765)).toBe(45)
  })
})
