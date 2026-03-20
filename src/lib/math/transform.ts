import type { Point, TransformDragSession } from '../types'

export const MIN_UNIFORM_SCALE = 0.01
export const MAX_UNIFORM_SCALE = 100
export const MIN_DRAG_DISTANCE = 10
export const SCREEN_Y_SCALE = 0.8

const DEGREES_PER_RADIAN = 180 / Math.PI

export function subtractPoints(a: Point, b: Point): Point {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
  }
}

export function vectorLength(vector: Point): number {
  return Math.hypot(vector.x, vector.y)
}

export function clampScale(scale: number): number {
  return Math.min(MAX_UNIFORM_SCALE, Math.max(MIN_UNIFORM_SCALE, scale))
}

export function normalizeRotationDeg(rotationDeg: number): number {
  return ((rotationDeg % 360) + 360) % 360
}

export function angleOfVectorDeg(vector: Point): number {
  return Math.atan2(vector.y, vector.x) * DEGREES_PER_RADIAN
}

export function normalizeScreenVector(vector: Point, screenScaleY: number): Point {
  const safeScaleY = Math.max(screenScaleY, 0.0001)

  return {
    x: vector.x,
    y: vector.y / safeScaleY,
  }
}

export function createTransformDragSession(
  anchorScreen: Point,
  pointerStartScreen: Point,
  startScale: number,
  startRotationDeg: number,
  screenScaleY: number,
): TransformDragSession | null {
  const startVector = normalizeScreenVector(subtractPoints(pointerStartScreen, anchorScreen), screenScaleY)
  const startDistance = vectorLength(startVector)

  if (startDistance < MIN_DRAG_DISTANCE) {
    return null
  }

  return {
    anchorScreen,
    pointerStartScreen,
    startVector,
    startDistance,
    startScale,
    startRotationDeg,
  }
}

export function projectTransformDrag(
  session: TransformDragSession,
  pointerScreen: Point,
  screenScaleY: number,
) {
  const nextVector = normalizeScreenVector(subtractPoints(pointerScreen, session.anchorScreen), screenScaleY)
  const nextDistance = Math.max(vectorLength(nextVector), 0.0001)
  const rotationDeltaDeg = angleOfVectorDeg(nextVector) - angleOfVectorDeg(session.startVector)

  return {
    uniformScale: clampScale(session.startScale * (nextDistance / session.startDistance)),
    rotationDeg: session.startRotationDeg + rotationDeltaDeg,
  }
}
