export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect extends Point, Size {}

export interface NormalizedPoint {
  x: number
  y: number
}

export type OverlayMode = 'transform' | 'select-anchor'

export interface OverlayTransformState {
  opacity: number
  uniformScale: number
  rotationDeg: number
  anchor: NormalizedPoint
  mode: OverlayMode
  clickThrough: boolean
}

export interface LoadedImageAsset {
  imagePath: string
  renderAssetPath: string
  sourceWidth: number
  sourceHeight: number
  format: string
}

export interface LoadedRenderableImageAsset extends LoadedImageAsset {
  renderSrc: string
}

export interface ToolbarReadouts {
  scaleText: string
  rotationText: string
}

export interface OverlaySessionState {
  imagePath: string | null
  renderAssetPath: string | null
  sourceSize: Size | null
  loadingImage: boolean
  windowPosition: Point
  state: OverlayTransformState
  loadedState: OverlayTransformState | null
  activeGrabPointSource: Point | null
  statusMessage: string
}

export interface OverlaySnapshot {
  imageLoaded: boolean
  imagePath: string | null
  sourceSize: Size | null
  loadingImage: boolean
  windowPosition: Point
  state: OverlayTransformState
  loadedState: OverlayTransformState | null
  readouts: ToolbarReadouts
  dragging: boolean
  statusMessage: string
}

export interface TransformDragSession {
  anchorScreen: Point
  pointerStartScreen: Point
  startVector: Point
  startDistance: number
  startScale: number
  startRotationDeg: number
}

export interface TransformedBounds {
  corners: Point[]
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  anchorRenderPosition: Point
  anchorSourcePosition: Point
}
