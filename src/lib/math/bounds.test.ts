import { describe, expect, it } from 'vitest'
import {
  clampWindowPositionToRect,
  computeInteractionSurfaceSize,
  constrainTransformedBoundsToWorkArea,
  computeInitialFitScale,
  computeTransformedBounds,
  mapRenderPointToSource,
  mapSourcePointToRender,
} from './bounds'
import { SCREEN_Y_SCALE } from './transform'

describe('bounds math', () => {
  it('auto-fits oversized images to roughly 80 percent of the display', () => {
    const scale = computeInitialFitScale(
      { width: 4000, height: 2000 },
      { x: 0, y: 0, width: 1000, height: 800 },
      0.8,
      SCREEN_Y_SCALE,
    )

    expect(scale).toBeCloseTo(0.2)
  })

  it('keeps native size when the image already fits comfortably', () => {
    const scale = computeInitialFitScale(
      { width: 320, height: 180 },
      { x: 0, y: 0, width: 1600, height: 900 },
      0.8,
      SCREEN_Y_SCALE,
    )

    expect(scale).toBe(1)
  })

  it('caps the interaction surface size while preserving aspect ratio', () => {
    const size = computeInteractionSurfaceSize({ width: 12000, height: 6000 })

    expect(size).toEqual({ width: 4096, height: 2048 })
  })

  it('computes transformed bounds around the top-left anchor', () => {
    const bounds = computeTransformedBounds({ width: 100, height: 50 }, { x: 0, y: 0 }, 1, 90, SCREEN_Y_SCALE)

    expect(bounds.width).toBeCloseTo(50)
    expect(bounds.height).toBeCloseTo(80)
    expect(bounds.anchorRenderPosition.x).toBeCloseTo(50)
    expect(bounds.anchorRenderPosition.y).toBeCloseTo(0)
  })

  it('applies screen-Y scaling to the initial fit calculation', () => {
    const scale = computeInitialFitScale(
      { width: 1000, height: 1000 },
      { x: 0, y: 0, width: 600, height: 600 },
      0.8,
      SCREEN_Y_SCALE,
    )

    expect(scale).toBeCloseTo(0.48)
  })

  it('round-trips between source and render coordinates with screen-Y scaling', () => {
    const sourceSize = { width: 512, height: 256 }
    const sourcePoint = { x: 200, y: 100 }
    const anchor = { x: 0.25, y: 0.75 } as const

    for (const rotationDeg of [0, 45, 90]) {
      const bounds = computeTransformedBounds(sourceSize, anchor, 0.5, rotationDeg, SCREEN_Y_SCALE)
      const renderPoint = mapSourcePointToRender(
        sourcePoint,
        sourceSize,
        anchor,
        0.5,
        rotationDeg,
        SCREEN_Y_SCALE,
        bounds,
      )
      const mappedBack = mapRenderPointToSource(
        renderPoint,
        bounds,
        sourceSize,
        anchor,
        0.5,
        rotationDeg,
        SCREEN_Y_SCALE,
      )

      expect(mappedBack.x).toBeCloseTo(sourcePoint.x, 6)
      expect(mappedBack.y).toBeCloseTo(sourcePoint.y, 6)
    }
  })

  it('computes post-scale bounds after a 90 degree rotation', () => {
    const bounds = computeTransformedBounds({ width: 120, height: 80 }, { x: 0, y: 0 }, 1, 90, SCREEN_Y_SCALE)

    expect(bounds.width).toBeCloseTo(80)
    expect(bounds.height).toBeCloseTo(96)
  })

  it('clamps window position inside the current work area', () => {
    const clamped = clampWindowPositionToRect(
      { x: -50, y: 900 },
      { width: 300, height: 200 },
      { x: 0, y: 0, width: 800, height: 600 },
    )

    expect(clamped).toEqual({ x: 0, y: 400 })
  })

  it('pins the anchor to the same screen point when the transformed bounds hit the work area edge', () => {
    const tightBounds = computeTransformedBounds(
      { width: 200, height: 120 },
      { x: 0, y: 0 },
      1,
      90,
      SCREEN_Y_SCALE,
    )
    const anchorScreen = { x: 18, y: 32 }
    const constrained = constrainTransformedBoundsToWorkArea(
      tightBounds,
      { x: 0, y: 0, width: 300, height: 200 },
      anchorScreen,
    )

    expect(constrained.windowPosition.x + constrained.bounds.anchorRenderPosition.x).toBeCloseTo(
      anchorScreen.x,
    )
    expect(constrained.windowPosition.y + constrained.bounds.anchorRenderPosition.y).toBeCloseTo(
      anchorScreen.y,
    )
    expect(constrained.windowPosition.x).toBeGreaterThanOrEqual(0)
    expect(constrained.windowPosition.y).toBeGreaterThanOrEqual(0)
  })
})
