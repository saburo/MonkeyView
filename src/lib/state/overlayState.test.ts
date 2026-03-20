import { describe, expect, it } from 'vitest'
import {
  cloneTransformState,
  createDefaultTransformState,
  createEmptySessionState,
  createSnapshot,
  formatRotationReadout,
} from './overlayState'

describe('overlay state helpers', () => {
  it('creates the specified default transform state', () => {
    const state = createDefaultTransformState()

    expect(state.anchor).toEqual({ x: 0, y: 0 })
    expect(state.mode).toBe('transform')
    expect(state.clickThrough).toBe(false)
  })

  it('clones transform state without sharing nested anchor references', () => {
    const state = createDefaultTransformState()
    const cloned = cloneTransformState(state)
    cloned.anchor.x = 0.5

    expect(state.anchor.x).toBe(0)
    expect(cloned.anchor.x).toBe(0.5)
  })

  it('formats clockwise rotation readouts in a normalized range', () => {
    expect(formatRotationReadout(-90)).toBe('270.0° CW')
  })

  it('builds a snapshot that reports dragging status from active grab state', () => {
    const session = createEmptySessionState()
    session.imagePath = '/tmp/reference.png'
    session.renderAssetPath = '/tmp/rendered-reference.png'
    session.sourceSize = { width: 640, height: 480 }
    session.activeGrabPointSource = { x: 12, y: 18 }

    const snapshot = createSnapshot(session)

    expect(snapshot.imageLoaded).toBe(true)
    expect(snapshot.loadingImage).toBe(false)
    expect(snapshot.dragging).toBe(true)
    expect(snapshot.readouts.scaleText).toBe('1.000x')
  })
})
