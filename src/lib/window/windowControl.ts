import {
  LogicalPosition,
  LogicalSize,
  Window as TauriWindow,
  currentMonitor,
  getCurrentWindow,
  monitorFromPoint,
} from '@tauri-apps/api/window'
import type { Point, Rect, Size } from '../types'
import { clampWindowPositionToRect } from '../math/bounds'

export const TOOLBAR_WINDOW_LABEL = 'toolbar'
export const OVERLAY_WINDOW_LABEL = 'overlay'
export const DEFAULT_TOOLBAR_SIZE: Size = {
  width: 876,
  height: 104,
}
export const TOOLBAR_DOCK_GAP = 10

export type AppWindow = ReturnType<typeof getCurrentWindow>

interface RoundedWindowGeometry {
  position: Point
  size: Size
}

function roundPoint(point: Point): Point {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  }
}

function roundSize(size: Size): Size {
  return {
    width: Math.max(1, Math.round(size.width)),
    height: Math.max(1, Math.round(size.height)),
  }
}

function pointsEqual(a: Point | null, b: Point | null): boolean {
  return Boolean(a && b && a.x === b.x && a.y === b.y)
}

function sizesEqual(a: Size | null, b: Size | null): boolean {
  return Boolean(a && b && a.width === b.width && a.height === b.height)
}

export async function getAppWindowByLabel(label: string): Promise<AppWindow | null> {
  return TauriWindow.getByLabel(label)
}

export async function getWindowLogicalPosition(window: AppWindow): Promise<Point> {
  const [position, scaleFactor] = await Promise.all([window.outerPosition(), window.scaleFactor()])

  return {
    x: position.x / scaleFactor,
    y: position.y / scaleFactor,
  }
}

export async function getWindowLogicalSize(window: AppWindow): Promise<Size> {
  const [size, scaleFactor] = await Promise.all([window.innerSize(), window.scaleFactor()])

  return {
    width: size.width / scaleFactor,
    height: size.height / scaleFactor,
  }
}

export async function physicalPointToLogical(window: AppWindow, point: Point): Promise<Point> {
  const scaleFactor = await window.scaleFactor()

  return {
    x: point.x / scaleFactor,
    y: point.y / scaleFactor,
  }
}

export async function setWindowLogicalPosition(window: AppWindow, point: Point): Promise<void> {
  await window.setPosition(new LogicalPosition(point.x, point.y))
}

export async function setWindowLogicalSize(window: AppWindow, size: Size): Promise<void> {
  await window.setSize(new LogicalSize(size.width, size.height))
}

export async function setOverlayClickThrough(window: AppWindow, enabled: boolean): Promise<void> {
  await window.setIgnoreCursorEvents(enabled)
}

export async function getCurrentMonitorWorkArea(window: AppWindow): Promise<Rect> {
  const windowPosition = await window.outerPosition()
  const monitor =
    (await monitorFromPoint(windowPosition.x, windowPosition.y)) ??
    (window.label === getCurrentWindow().label ? await currentMonitor() : null)

  if (monitor) {
    const scaleFactor = monitor.scaleFactor

    return {
      x: monitor.workArea.position.x / scaleFactor,
      y: monitor.workArea.position.y / scaleFactor,
      width: monitor.workArea.size.width / scaleFactor,
      height: monitor.workArea.size.height / scaleFactor,
    }
  }

  const fallbackPosition = await getWindowLogicalPosition(window)
  const fallbackSize = await getWindowLogicalSize(window)

  return {
    x: fallbackPosition.x,
    y: fallbackPosition.y,
    width: Math.max(fallbackSize.width, 1280),
    height: Math.max(fallbackSize.height, 800),
  }
}

export function computeDockedToolbarPosition(
  overlayPosition: Point,
  overlaySize: Size,
  toolbarSize: Size,
  workArea: Rect,
): Point {
  const desiredPosition = {
    x: overlayPosition.x + (overlaySize.width - toolbarSize.width) / 2,
    y: overlayPosition.y - toolbarSize.height - TOOLBAR_DOCK_GAP,
  }

  return clampWindowPositionToRect(desiredPosition, toolbarSize, workArea)
}

export function createWindowGeometryScheduler(window: AppWindow) {
  let pendingGeometry: RoundedWindowGeometry | null = null
  let animationFrameId: number | null = null
  let lastAppliedGeometry: RoundedWindowGeometry | null = null

  const applyGeometry = async (geometry: RoundedWindowGeometry) => {
    if (!pointsEqual(lastAppliedGeometry?.position ?? null, geometry.position)) {
      await setWindowLogicalPosition(window, geometry.position)
    }

    if (!sizesEqual(lastAppliedGeometry?.size ?? null, geometry.size)) {
      await setWindowLogicalSize(window, geometry.size)
    }

    lastAppliedGeometry = geometry
  }

  const flush = async () => {
    animationFrameId = null

    if (!pendingGeometry) {
      return
    }

    const geometry = pendingGeometry
    pendingGeometry = null
    await applyGeometry(geometry)
  }

  return {
    schedule(geometry: { position: Point; size: Size }) {
      pendingGeometry = {
        position: roundPoint(geometry.position),
        size: roundSize(geometry.size),
      }

      if (animationFrameId === null) {
        animationFrameId = requestAnimationFrame(() => {
          void flush()
        })
      }
    },
    async sync(geometry: { position: Point; size: Size }) {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }

      pendingGeometry = null

      await applyGeometry({
        position: roundPoint(geometry.position),
        size: roundSize(geometry.size),
      })
    },
  }
}

export function createWindowPositionScheduler(window: AppWindow) {
  let pendingPosition: Point | null = null
  let animationFrameId: number | null = null
  let lastAppliedPosition: Point | null = null

  const applyPosition = async (position: Point) => {
    if (!pointsEqual(lastAppliedPosition, position)) {
      await setWindowLogicalPosition(window, position)
      lastAppliedPosition = position
    }
  }

  const flush = async () => {
    animationFrameId = null

    if (!pendingPosition) {
      return
    }

    const nextPosition = pendingPosition
    pendingPosition = null
    await applyPosition(nextPosition)
  }

  return {
    schedule(position: Point) {
      pendingPosition = roundPoint(position)

      if (animationFrameId === null) {
        animationFrameId = requestAnimationFrame(() => {
          void flush()
        })
      }
    },
    async sync(position: Point) {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }

      pendingPosition = null
      await applyPosition(roundPoint(position))
    },
  }
}

export function createWindowOnTopPromoter(window: AppWindow) {
  let animationFrameId: number | null = null
  let inflightPromotion: Promise<void> | null = null

  const promote = async () => {
    if (inflightPromotion) {
      await inflightPromotion
      return
    }

    inflightPromotion = (async () => {
      await window.show().catch(() => undefined)
      await window.setAlwaysOnTop(false).catch(() => undefined)
      await window.setAlwaysOnTop(true).catch(() => undefined)
    })().finally(() => {
      inflightPromotion = null
    })

    await inflightPromotion
  }

  return {
    schedule() {
      if (animationFrameId !== null) {
        return
      }

      animationFrameId = requestAnimationFrame(() => {
        animationFrameId = null
        void promote()
      })
    },
    async sync() {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }

      await promote()
    },
  }
}
