import type { NormalizedPoint, Point, Rect, Size, TransformedBounds } from '../types'
import { clampScale } from './transform'

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function getAnchorSourcePosition(sourceSize: Size, anchor: NormalizedPoint): Point {
  return {
    x: clampNumber(anchor.x, 0, 1) * sourceSize.width,
    y: clampNumber(anchor.y, 0, 1) * sourceSize.height,
  }
}

export function rotateVectorClockwise(vector: Point, rotationDeg: number): Point {
  const radians = (rotationDeg * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)

  return {
    x: vector.x * cosine - vector.y * sine,
    y: vector.x * sine + vector.y * cosine,
  }
}

export function transformSourcePoint(
  point: Point,
  sourceSize: Size,
  anchor: NormalizedPoint,
  uniformScale: number,
  rotationDeg: number,
): Point {
  const anchorSourcePosition = getAnchorSourcePosition(sourceSize, anchor)
  const relative = {
    x: point.x - anchorSourcePosition.x,
    y: point.y - anchorSourcePosition.y,
  }
  const scaled = {
    x: relative.x * uniformScale,
    y: relative.y * uniformScale,
  }
  const rotated = rotateVectorClockwise(scaled, rotationDeg)

  return {
    x: anchorSourcePosition.x + rotated.x,
    y: anchorSourcePosition.y + rotated.y,
  }
}

export function computeTransformedBounds(
  sourceSize: Size,
  anchor: NormalizedPoint,
  uniformScale: number,
  rotationDeg: number,
): TransformedBounds {
  const corners = [
    { x: 0, y: 0 },
    { x: sourceSize.width, y: 0 },
    { x: sourceSize.width, y: sourceSize.height },
    { x: 0, y: sourceSize.height },
  ].map((point) => transformSourcePoint(point, sourceSize, anchor, uniformScale, rotationDeg))

  const xValues = corners.map((point) => point.x)
  const yValues = corners.map((point) => point.y)
  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(...yValues)
  const maxY = Math.max(...yValues)
  const anchorSourcePosition = getAnchorSourcePosition(sourceSize, anchor)

  return {
    corners,
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    offsetX: -minX,
    offsetY: -minY,
    anchorRenderPosition: {
      x: anchorSourcePosition.x - minX,
      y: anchorSourcePosition.y - minY,
    },
    anchorSourcePosition,
  }
}

export function constrainTransformedBoundsToWorkArea(
  bounds: TransformedBounds,
  workArea: Rect,
  anchorScreen: Point,
): { bounds: TransformedBounds; windowPosition: Point } {
  const workAreaMaxX = workArea.x + workArea.width
  const workAreaMaxY = workArea.y + workArea.height
  const leftSpan = bounds.anchorSourcePosition.x - bounds.minX
  const rightSpan = bounds.maxX - bounds.anchorSourcePosition.x
  const topSpan = bounds.anchorSourcePosition.y - bounds.minY
  const bottomSpan = bounds.maxY - bounds.anchorSourcePosition.y
  const availableLeft = clampNumber(anchorScreen.x - workArea.x, 0, Math.max(0, workArea.width))
  const availableRight = clampNumber(workAreaMaxX - anchorScreen.x, 0, Math.max(0, workArea.width))
  const availableTop = clampNumber(anchorScreen.y - workArea.y, 0, Math.max(0, workArea.height))
  const availableBottom = clampNumber(workAreaMaxY - anchorScreen.y, 0, Math.max(0, workArea.height))
  const leftVisible = Math.min(leftSpan, availableLeft)
  const rightVisible = Math.min(rightSpan, availableRight)
  const topVisible = Math.min(topSpan, availableTop)
  const bottomVisible = Math.min(bottomSpan, availableBottom)
  const windowPosition = {
    x: anchorScreen.x - leftVisible,
    y: anchorScreen.y - topVisible,
  }

  return {
    bounds: {
      ...bounds,
      width: Math.max(1, leftVisible + rightVisible),
      height: Math.max(1, topVisible + bottomVisible),
      offsetX: leftVisible - bounds.anchorSourcePosition.x,
      offsetY: topVisible - bounds.anchorSourcePosition.y,
      anchorRenderPosition: {
        x: leftVisible,
        y: topVisible,
      },
    },
    windowPosition,
  }
}

export function mapSourcePointToRender(
  sourcePoint: Point,
  sourceSize: Size,
  anchor: NormalizedPoint,
  uniformScale: number,
  rotationDeg: number,
  bounds: TransformedBounds,
): Point {
  const transformed = transformSourcePoint(sourcePoint, sourceSize, anchor, uniformScale, rotationDeg)

  return {
    x: transformed.x + bounds.offsetX,
    y: transformed.y + bounds.offsetY,
  }
}

export function mapRenderPointToSource(
  renderPoint: Point,
  bounds: TransformedBounds,
  sourceSize: Size,
  anchor: NormalizedPoint,
  uniformScale: number,
  rotationDeg: number,
): Point {
  const anchorSourcePosition = getAnchorSourcePosition(sourceSize, anchor)
  const transformedPoint = {
    x: renderPoint.x - bounds.offsetX,
    y: renderPoint.y - bounds.offsetY,
  }
  const relative = {
    x: transformedPoint.x - anchorSourcePosition.x,
    y: transformedPoint.y - anchorSourcePosition.y,
  }
  const unrotated = rotateVectorClockwise(relative, -rotationDeg)
  const safeScale = Math.max(clampScale(uniformScale), 0.0001)

  return {
    x: anchorSourcePosition.x + unrotated.x / safeScale,
    y: anchorSourcePosition.y + unrotated.y / safeScale,
  }
}

export function normalizeSourcePoint(sourcePoint: Point, sourceSize: Size): NormalizedPoint {
  return {
    x: clampNumber(sourcePoint.x / Math.max(1, sourceSize.width), 0, 1),
    y: clampNumber(sourcePoint.y / Math.max(1, sourceSize.height), 0, 1),
  }
}

export function isSourcePointInsideImage(sourcePoint: Point, sourceSize: Size): boolean {
  return (
    sourcePoint.x >= 0 &&
    sourcePoint.y >= 0 &&
    sourcePoint.x <= sourceSize.width &&
    sourcePoint.y <= sourceSize.height
  )
}

export function computeInitialFitScale(sourceSize: Size, workArea: Rect, fitRatio = 0.8): number {
  const maxWidth = workArea.width * fitRatio
  const maxHeight = workArea.height * fitRatio
  const widthScale = maxWidth / Math.max(1, sourceSize.width)
  const heightScale = maxHeight / Math.max(1, sourceSize.height)
  const scale = Math.min(1, widthScale, heightScale)

  return clampScale(scale)
}

export function clampWindowPositionToRect(position: Point, size: Size, rect: Rect): Point {
  const xMax = rect.x + Math.max(0, rect.width - size.width)
  const yMax = rect.y + Math.max(0, rect.height - size.height)

  return {
    x: clampNumber(position.x, rect.x, xMax),
    y: clampNumber(position.y, rect.y, yMax),
  }
}
