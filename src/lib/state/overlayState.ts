import { normalizeRotationDeg } from '../math/transform'
import type { OverlaySessionState, OverlaySnapshot, OverlayTransformState } from '../types'

export function createDefaultTransformState(): OverlayTransformState {
  return {
    opacity: 1,
    uniformScale: 1,
    rotationDeg: 0,
    anchor: {
      x: 0,
      y: 0,
    },
    mode: 'transform',
    clickThrough: false,
  }
}

export function cloneTransformState(state: OverlayTransformState): OverlayTransformState {
  return {
    opacity: state.opacity,
    uniformScale: state.uniformScale,
    rotationDeg: state.rotationDeg,
    anchor: {
      x: state.anchor.x,
      y: state.anchor.y,
    },
    mode: state.mode,
    clickThrough: state.clickThrough,
  }
}

export function createEmptySessionState(): OverlaySessionState {
  return {
    imagePath: null,
    renderAssetPath: null,
    sourceSize: null,
    loadingImage: false,
    windowPosition: {
      x: 0,
      y: 0,
    },
    state: createDefaultTransformState(),
    loadedState: null,
    activeGrabPointSource: null,
    statusMessage: '',
  }
}

export function formatScaleReadout(scale: number): string {
  if (scale >= 10) {
    return `${scale.toFixed(2)}x`
  }

  if (scale >= 1) {
    return `${scale.toFixed(3)}x`
  }

  return `${scale.toFixed(4)}x`
}

export function formatRotationReadout(rotationDeg: number): string {
  return `${normalizeRotationDeg(rotationDeg).toFixed(1)}° CW`
}

export function createSnapshot(session: OverlaySessionState): OverlaySnapshot {
  return {
    imageLoaded: Boolean(session.imagePath && session.renderAssetPath && session.sourceSize),
    imagePath: session.imagePath,
    sourceSize: session.sourceSize,
    loadingImage: session.loadingImage,
    windowPosition: {
      x: session.windowPosition.x,
      y: session.windowPosition.y,
    },
    state: cloneTransformState(session.state),
    loadedState: session.loadedState ? cloneTransformState(session.loadedState) : null,
    readouts: {
      scaleText: formatScaleReadout(session.state.uniformScale),
      rotationText: formatRotationReadout(session.state.rotationDeg),
    },
    dragging: session.activeGrabPointSource !== null,
    statusMessage: session.statusMessage,
  }
}

export function createEmptySnapshot(): OverlaySnapshot {
  return createSnapshot(createEmptySessionState())
}
